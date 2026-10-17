import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The GitHub pull request flow, offline: the captain's Connect card writes a signed grant that
// Projects.assertExecutable verifies (and refuses on a changed origin, repository or base); a
// repository with a pull request template gets its pull request only after the evidence, from the
// coordinator's filled template (every heading, Studio's test table, checkboxes ticked only by
// evidence), shown exactly on the captain's "Open this pull request?" card; Open pushes with a
// lease and POSTs that exact body. No template keeps the old publication; several templates
// raise a pick card; a required input nobody can fill holds on a card.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { installGitHubConnect, startGitHubConnect, CONNECT_WORKFLOW } from "../src/github-connect";
import { grantSignature } from "../src/github-grant";
import { bundledText } from "../src/bundled";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("github-pr-flow");
const temp = checkedTempDir("gh-pr-flow-"); setGitHome(join(temp, "git-home"));
const TEMPLATE = readFileSync(join(import.meta.dir, "fixture/github/money-kit-pull_request_template.md"), "utf8");
const repoAt = (name: string, origin: string) => { const r = join(temp, name); mkdirSync(r); assertTempRepo(r); must(r, ["init", "-qb", "main"]); writeFileSync(join(r, "file"), "base"); must(r, ["add", "."]); must(r, ["commit", "-qm", "base"]); must(r, ["remote", "add", "origin", origin]); return r; };

// ---------- 1. the captain's Connect card writes a signed grant; assertExecutable verifies it ----------
{
  const repo = repoAt("money-kit", "https://github.com/fixture/money-kit.git");
  const H = await harness([bundledText(`workflows/v2/${CONNECT_WORKFLOW}.wf.yaml`)!]), E = H.engine, projects = new Projects(H.data);
  writeFileSync(join(H.data, "projects.json"), JSON.stringify([{ id: "mk", name: "money-kit", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }]));
  mkdirSync(join(H.data, "policies"), { recursive: true }); writeFileSync(join(H.data, "policies", "project-mk.yaml"), JSON.stringify({ branch_prefix: "feature/" }));
  installGitHubConnect(E, projects);
  try {
    const run = startGitHubConnect(E, projects, "mk", "captain (test)");
    await until(() => E.cards.list({ run: run.id, open: true }).length > 0, 8000);
    const card = E.cards.list({ run: run.id, open: true })[0];
    ok(!!card?.captainOnly && card.kind === "permission" && /fixture\/money-kit/.test(card.title.en) && /Push URL[^\n]*https:\/\/github\.com\/fixture\/money-kit\.git/.test(card.body) && /Branch prefix[^\n]*feature\//.test(card.body) && /Base[^\n]*main/.test(card.body) && /merging on GitHub/i.test(card.body),
      "the Connect card is captain-only and shows repository, push URL, base, branch prefix and that merge stays off", card?.body);
    ok(!JSON.parse(readFileSync(join(H.data, "projects.json"), "utf8"))[0].github, "nothing is written before the captain answers");
    await E.answer(card.id, { choice: "approve", by: "captain" } as any);
    await until(() => run.status === "succeeded" || run.status === "failed", 8000);
    const g = JSON.parse(readFileSync(join(H.data, "projects.json"), "utf8"))[0].github;
    ok(run.status === "succeeded" && g?.mode === "github" && g.repository === "fixture/money-kit" && g.pushUrl === "https://github.com/fixture/money-kit.git" && g.branchPrefix === "feature/" && g.approvalId === `${run.id}/${card.id}` && /^[a-f0-9]{64}$/.test(g.signature) && !g.operations,
      "approve writes the signed grant (no operations grant: merge stays off)", JSON.stringify(g));
    ok(projects.assertExecutable({ project: "mk", base: "main" }) === true && projects.staffingAssess("mk").ok, "the written grant verifies, and staffing accepts the project");
    ok(E.trusted(run.id).entries.some((e) => e.record === "github-grant-written" && e.data?.repository === "fixture/money-kit"), "the ledger records the written grant");
    const refuses = (label: string, f: () => void, re: RegExp) => { let m = ""; try { f(); } catch (e: any) { m = e.message; } ok(re.test(m), `assertExecutable refuses ${label}`, m); };
    const file = join(H.data, "projects.json"), good = readFileSync(file, "utf8"), edit = (f: (p: any) => void) => { const a = JSON.parse(good); f(a[0]); writeFileSync(file, JSON.stringify(a)); };
    must(repo, ["remote", "set-url", "origin", "https://github.com/someone-else/money-kit.git"]);
    refuses("a local origin that is not the granted repository", () => projects.assertExecutable({ project: "mk", base: "main" }), /origin/);
    must(repo, ["remote", "set-url", "origin", "git@github.com:fixture/money-kit.git"]);
    ok(projects.assertExecutable({ project: "mk", base: "main" }) === true, "the same repository over SSH still verifies");
    edit((p) => { p.github.repository = "fixture/other"; p.github.pushUrl = "https://github.com/fixture/other.git"; });
    refuses("an edited repository (signature)", () => projects.assertExecutable({ project: "mk", base: "main" }), /not signed/);
    edit((p) => { p.base = "develop"; });
    refuses("a registration base the grant was not approved for", () => projects.assertExecutable({ project: "mk", base: "develop" }), /signed|base/);
    edit((p) => { delete p.github.signature; });
    refuses("an unsigned grant", () => projects.assertExecutable({ project: "mk", base: "main" }), /not signed/);
    edit((p) => { p.github.base = "develop"; p.github.signature = grantSignature(H.data, p, p.github); });
    refuses("a grant base that differs from the registered base", () => projects.assertExecutable({ project: "mk", base: "main" }), /base/);
    edit((p) => { p.github.signature = "0".repeat(64); });
    ok(projects.staffingAssess("mk").ok === false && (projects.staffingAssess("mk") as any).reason === "external_unverified", "staffing refuses a grant that does not verify (external_unverified)");
    writeFileSync(file, good);
    let refused = ""; try { startGitHubConnect(E, projects, "mk", "captain"); } catch (e: any) { refused = e.message; } ok(/already connected/.test(refused), "a verified project is not proposed again", refused);
    const plain = repoAt("no-github", "https://gitlab.com/fixture/x.git"); writeFileSync(file, JSON.stringify([...JSON.parse(good), { id: "gl", name: "gl", path: plain, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }]));
    refused = ""; try { startGitHubConnect(E, projects, "gl", "captain"); } catch (e: any) { refused = e.message; } ok(/not a github\.com repository/.test(refused), "a project whose origin is not GitHub cannot be connected", refused);
  } catch (e: any) { ok(false, "unexpected connect error", e.stack); } finally { H.stop(); }
}

// ---------- 2. the pull request: template, evidence, captain card, lease push + POST ----------
{
  const repo = repoAt("source", "https://github.com/fixture/project.git"), bare = join(temp, "remote.git");
  must(temp, ["clone", "--bare", "-q", repo, bare]);
  writeFileSync(join(repo, "file"), "change"); must(repo, ["commit", "-qam", "change"]); const head = must(repo, ["rev-parse", "HEAD"]), baseCommit = must(repo, ["rev-parse", "HEAD~1"]);
  const sim = githubSimulator(bare);
  sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [], contexts: [] });
  sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 0, check_runs: [] });
  sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] });
  const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "test" };
  const flow = Y({ id: "pr-flow", name: "PR flow", roles: [{ id: "coordinator", label: "Coordinator" }], nodes: [
    { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
    { id: "remote-ready", kind: "hook", do: "remote.ready", label: "Ready", x: 2, y: 0 },
    { id: "done", kind: "hook", label: "Done", x: 4, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 4, y: 1 }],
    edges: [["seed", "pr-open"], ["pr-open", "remote-ready", "ok"], ["pr-open", "closed", "close"], ["remote-ready", "done", "ok"], ["remote-ready", "closed", "close"]] });
  const update = Y({ id: "pr-update", name: "PR update", roles: [], nodes: [{ id: "copy", kind: "hook", do: "fixture.copy", label: "Copy", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }], edges: [["copy", "pr-open"], ["pr-open", "done", "ok"]] });
  const refreshFlow = Y({ id: "pr-refresh", name: "PR refresh", roles: [{ id: "coordinator", label: "Coordinator" }], nodes: [{ id: "copy", kind: "hook", do: "fixture.copy-proven", label: "Copy", x: 0, y: 0 }, { id: "remote-ready", kind: "hook", do: "remote.ready", label: "Ready", x: 1, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 1 }], edges: [["copy", "remote-ready"], ["remote-ready", "done", "ok"], ["remote-ready", "closed", "close"]] });
  const mergeView = Y({ id: "merge-view", name: "Merge view", roles: [], nodes: [{ id: "copy", kind: "hook", do: "fixture.copy", label: "Copy", x: 0, y: 0 }, { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, x: 1, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 0 }], edges: [["copy", "merge-card"], ["merge-card", "closed", "close"]] });
  let source: any = null;
  const H = await harness([flow, update, refreshFlow, mergeView]), E = H.engine;
  installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter: new GitHubPrAdapter(grant, () => "fake-token", 3000) });
  const done = ["Prices in euro format as €1,234.50 (test/format.test.ts)", "Unknown currencies keep the code prefix (test/codes.test.ts)"];
  E.actions["fixture.seed"] = (x) => {
    Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit, head: must(repo, ["rev-parse", "HEAD"]), branch: x.run.params.branch, door: { door: "two-way" },
      spec: { title: "Format euro prices", what: "Show euro prices with the euro sign and grouping.", why: ["Shoppers in the EU read prices wrongly."], done, scope: ["file"], rollback: "Revert the pull request." } });
    // Studio's own evidence at this head: CI and fail-first pass (fail-first proves done line 1), the reviewer approved
    E.record(x, "check", { check: "firstmate/ci", verdict: "pass", kind: "deterministic", data: { shards: [] } } as any);
    E.record(x, "check", { check: "firstmate/fail-first", verdict: "pass", kind: "deterministic", proves: [0], data: { applicable: true } } as any);
    E.record(x, "check", { check: "firstmate/review-verdict", verdict: "pass", kind: "judged" } as any);
    return "ok";
  };
  E.actions["fixture.copy"] = (x) => { Object.assign(x.ctx, structuredClone(source)); return "ok"; };
  // the later round's evidence: CI and fail-first pass at the new head
  E.actions["fixture.copy-proven"] = (x) => { Object.assign(x.ctx, structuredClone(source)); E.record(x, "check", { check: "firstmate/ci", verdict: "pass", kind: "deterministic", data: { shards: [] } } as any); E.record(x, "check", { check: "firstmate/fail-first", verdict: "pass", kind: "deterministic", proves: [0], data: { applicable: true } } as any); return "ok"; };
  // the coordinator: scripted answers to pull_request_text; the prompt each time is kept
  const prompts: string[] = []; let answer: (n: number) => any = () => null;
  (E.deps.agents as any).run = async (job: any) => { prompts.push(job.text); const t = job.tools.find((t: any) => t.name === "pull_request_text"); const a = answer(prompts.length); if (t && a) t.run(a); return { status: "done" }; };
  const fill = (extra: any = {}) => ({ title: "Format euro prices with the euro sign", sections: [
    { heading: "Summary", text: "Euro prices now show the euro sign and thousands grouping." }, { heading: "Why", text: "Shoppers in the EU read prices wrongly.\nhttps://claude.ai/code/" + "session_0123 should never reach GitHub" },
    { heading: "Changes", text: "- Library: euro formatting" }, { heading: "How it was tested", text: "Fail-first tests on main, CI on the head." },
    { heading: "Screenshots", text: "No UI change" }, { heading: "Risk and rollback", text: "Low risk. Revert the pull request." }],
    ticks: [{ item: "Amounts stay integer cents end to end", evidence: "review" }, { item: "Docs and comments updated where behaviour changed", evidence: "made-up" }, { item: "`bun run lint` passes", evidence: "review" }], ...extra });
  const startRun = async (branch: string) => { const r = E.start({ workflow: "pr-flow", text: "Format euro prices", params: { branch } }); await until(() => !!E.cards.list({ run: r.id, open: true }).length || ["succeeded", "failed"].includes(r.status), 15000); return r; };
  const openCard = (r: any) => E.cards.list({ run: r.id, open: true })[0];
  try {
    // GitHub refuses the template read: a hold card on pr-open, never "no template"; closing it ends the Task closed
    sim.fail({ method: "GET", status: 403 });
    const unread = await startRun("crew/unread"); const uc = openCard(unread);
    sim.fail(null);
    ok(uc?.node === "pr-open" && uc.title.en === "GitHub contribution files could not be read" && !sim.head("crew/unread"), "a refused template read holds on pr-open; nothing pushed", uc?.title?.en);
    await E.answer(uc.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(unread.status), 8000);
    ok(unread.status === "succeeded" && unread.result === "closed", "Close without a pull request ends the Task closed (pr-open close edge)", `${unread.status} ${unread.result}`);

    // no template: the old publication right after the build (spec, Door, Rollback), no card
    const plain = await startRun("crew/plain");
    await until(() => ["succeeded", "failed"].includes(plain.status), 15000);
    const p1 = [...sim.pulls.values()].find((p) => p.head.ref === "crew/plain");
    ok(plain.status === "succeeded" && !!p1 && p1.body.includes("## Door\ntwo-way") && p1.body.includes("## Rollback") && !E.cards.list({ run: plain.id }).length, "no template: the pull request opens right after the build with the spec, door and rollback, no card", `${plain.status} ${p1?.body?.slice(0, 80)}`);

    // one template
    sim.community.set(".github/pull_request_template.md", TEMPLATE);
    answer = (n) => n === 1 ? fill() : fill({ title: "Format euro prices (euro sign, grouping)" }); // n 2: the captain's change; n 3: the rebased head
    const before = sim.calls.length;
    const run = await startRun("crew/euro");
    const card = openCard(run);
    ok(run.nodes["pr-open"]?.visits >= 1 && run.ctx.prDeferred?.version === 1 && !sim.head("crew/euro"), "a template defers the pull request past pr-open: nothing pushed", JSON.stringify(run.ctx.prDeferred));
    ok(card?.node === "remote-ready" && card.captainOnly && card.title.en === "Open this pull request?" && card.options.map((o: any) => o.id).join() === "open,changes,close", "the captain card 'Open this pull request?' is raised", card?.title?.en);
    ok(!sim.calls.slice(before).some((c) => c.method !== "GET") && !sim.head("crew/euro"), "no push and no POST before the captain answers");
    const pr = card.pullRequest, body: string = pr.body;
    ok(pr.repository === "fixture/project" && pr.branch === "crew/euro" && pr.base === "main" && pr.head === head && pr.draft === false && pr.title === "Format euro prices with the euro sign", "the card names the target repository, branch, base, head and the exact title");
    const headings = TEMPLATE.split("\n").filter((l) => l.startsWith("## "));
    let at = -1; ok(headings.every((h) => { const i = body.indexOf(h + "\n", at + 1); const okay = i > at; at = i; return okay; }), "every template heading is present, in order", body);
    ok(!body.replace(/<!-- \/?crew-studio:pr-text[^>]*-->/g, "").includes("<!--") && body.startsWith(`<!-- crew-studio:pr-text head=${head} hash=`) && body.includes("Euro prices now show the euro sign") && body.includes("Revert the pull request"), "the guidance comments give way to the coordinator's text");
    ok(body.includes("| Prices in euro format as €1,234.50 | test/format.test.ts | Yes (fail-first at " + head.slice(0, 8) + ") |") && body.includes("| Unknown currencies keep the code prefix | test/codes.test.ts | Not proven |") && !/\|\s+\|\s+\|\s+\|/.test(body),
      "the test table has a row per done line with its test and the fail-first result", body);
    ok(body.includes("- [x] `bun test` passes") && body.includes("- [ ] `bun run lint` passes"), "test-suite box ticked by CI; lint box stays unchecked without lint evidence (a cited review does not prove it)");
    ok(body.includes("- [x] Amounts stay integer cents end to end") && body.includes("- [ ] Docs and comments updated where behaviour changed") && body.includes("- [ ] Existing currencies (USD, JPY) format exactly as before"), "a box is ticked only with real cited evidence; unproven boxes stay unchecked");
    ok(!/claude\.ai\/code\/session/.test(body + pr.title) && card.body.includes(body), "a claude.ai session link never reaches the body; the card text carries the exact body");
    ok(prompts[0].includes("plain") || prompts[0].includes("PULL REQUEST TEXT"), "the coordinator is asked to fill the template");
    // the captain asks for changes: the coordinator revises with the note; a fresh card
    await E.answer(card.id, { choice: "changes", note: "Mention the grouping in the title", by: "captain" } as any);
    await until(() => !!openCard(run) && openCard(run).id !== card.id, 10000);
    const card2 = openCard(run);
    ok(prompts.length >= 2 && prompts[1].includes("Mention the grouping in the title") && card2?.pullRequest?.title === "Format euro prices (euro sign, grouping)" && !sim.head("crew/euro"), "Change the text: the coordinator revises with the captain's note; still nothing pushed", prompts[1]?.slice(-300));
    // the head moves under the card (a round rebased the Task): Open never pushes the head it did not show; a fresh card shows the rebased head
    writeFileSync(join(repo, "file"), "rebased"); must(repo, ["commit", "-qam", "rebased"]); const head2 = must(repo, ["rev-parse", "HEAD"]); run.ctx.head = head2;
    for (const h of [head2]) { sim.expect("GET", `/commits/${h}/check-runs?filter=all&per_page=100&page=1`, { total_count: 0, check_runs: [] }); sim.expect("GET", `/commits/${h}/status?per_page=100&page=1`, { sha: h, total_count: 0, statuses: [] }); }
    await E.answer(card2.id, { choice: "open", by: "captain" } as any);
    await until(() => !!openCard(run) && openCard(run).id !== card2.id, 10000);
    const card3 = openCard(run);
    ok(card3?.title.en === "Open this pull request?" && card3.pullRequest.head === head2 && card3.body.includes(`Head: ${head2}`) && !sim.head("crew/euro"), "a moved (rebased) head gets a fresh card showing that head; nothing is pushed from the stale card", card3?.pullRequest?.head);
    await E.answer(card3.id, { choice: "open", by: "captain" } as any);
    await until(() => ["succeeded", "failed"].includes(run.status), 15000);
    const opened = [...sim.pulls.values()].find((p) => p.head.ref === "crew/euro");
    const post = sim.calls.find((c) => c.method === "POST" && c.path === "/pulls" && c.body?.head === "crew/euro");
    ok(sim.head("crew/euro") === head2 && post?.body?.body === card3.pullRequest.body && post?.body?.title === card3.pullRequest.title && post.body.draft === undefined && opened?.body === card3.pullRequest.body, "Open: the shown head is pushed and POST /pulls carries exactly the card's title and body (ready for review)");
    ok(run.status === "succeeded" && run.ctx.pr?.url === `https://github.com/fixture/project/pull/${opened?.number}` && E.trusted(run.id).entries.some((e) => e.record === "pr-opened" && e.data?.url === run.ctx.pr.url && e.data?.number === String(opened?.number)), "the pull request number and URL are in the run and its ledger", `${run.status} ${JSON.stringify(run.ctx.pr)}`);
    // a later round (per-round rebase) moves the opened pull request: the same lease push, the approved text kept, a remote-push record
    writeFileSync(join(repo, "file"), "next round"); must(repo, ["commit", "-qam", "next round"]); const head3 = must(repo, ["rev-parse", "HEAD"]);
    sim.expect("GET", `/commits/${head3}/check-runs?filter=all&per_page=100&page=1`, { total_count: 0, check_runs: [] }); sim.expect("GET", `/commits/${head3}/status?per_page=100&page=1`, { sha: head3, total_count: 0, statuses: [] });
    source = structuredClone(run.ctx); source.head = head3;
    const upd = E.start({ workflow: "pr-update", text: "next round" }); await until(() => ["succeeded", "failed"].includes(upd.status), 15000);
    const patch = sim.calls.filter((c) => c.method === "PATCH").at(-1);
    ok(upd.status === "succeeded" && sim.head("crew/euro") === head3 && JSON.stringify(patch?.body) === JSON.stringify({ base: "main" }) && opened?.body === card3.pullRequest.body && upd.ctx.pr.body === card3.pullRequest.body && E.trusted(upd.id).entries.some((e) => e.record === "remote-push" && e.data?.from === head2 && e.data?.to === head3 && e.data?.lease === head2),
      "after the pull request exists, a new round's head is pushed with the lease on the last pushed head, and the text on GitHub is left as it is (the PATCH sends the base alone)", `${upd.status} ${JSON.stringify(patch?.body)} ${upd.steps.map((s: any) => s.error).filter(Boolean).join(" | ")}`);

    // the later round left the opened text on head2's evidence: remote-ready offers the refreshed text as a diff; nothing changes on GitHub until Update
    source = structuredClone(upd.ctx);
    const patches = () => sim.calls.filter((c) => c.method === "PATCH").length, p0 = patches();
    const rf = E.start({ workflow: "pr-refresh", text: "refresh" }); await until(() => !!openCard(rf) || ["succeeded", "failed"].includes(rf.status), 15000);
    const rc = openCard(rf);
    ok(rc?.title.en === `Update the text of pull request #${upd.ctx.pr.id}?` && rc.captainOnly && rc.options.map((o: any) => o.id).join() === "update-text,keep-text,close" && patches() === p0
      && rc.body.includes("-| Prices in euro format as €1,234.50 | test/format.test.ts | Not proven |") && rc.body.includes(`+| Prices in euro format as €1,234.50 | test/format.test.ts | Yes (fail-first at ${head3.slice(0, 8)}) |`),
      "a moved head offers 'Update the text' with a diff against the text on GitHub; nothing is edited before the captain answers", rc?.body?.slice(0, 4000));
    await E.answer(rc.id, { choice: "update-text", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(rf.status), 15000);
    const edit = sim.calls.filter((c) => c.method === "PATCH").at(-1), shown = rc.body.split("\nNew text:\n")[1];
    ok(rf.status === "succeeded" && patches() === p0 + 1 && edit?.body?.body === shown && rf.ctx.pr.body === shown && sim.head("crew/euro") === head3 && E.trusted(rf.id).entries.some((e) => e.record === "pr-text-updated" && e.data?.pr === upd.ctx.pr.id),
      "Update PATCHes exactly the shown text (the head stays), records it, and remote-ready goes on", `${rf.status} ${patches() - p0}`);
    // markers alone do not make a text current: a Task with no signed record of having written it offers the update again
    const rk = E.start({ workflow: "pr-refresh", text: "refresh again" }); await until(() => !!openCard(rk) || ["succeeded", "failed"].includes(rk.status), 15000);
    const kc = openCard(rk);
    ok(kc?.title.en.startsWith("Update the text") && /no record of writing that text/.test(kc.sections.en.why) && patches() === p0 + 1, "a text whose markers name the head but that this Task has no record of is offered again, not trusted", `${rk.status} ${kc?.sections?.en?.why}`);
    await E.answer(kc.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(rk.status), 15000);

    // the merge card with no operations grant: the pull request is open; merge it on GitHub (with its link)
    // the text gate before the merge is pr-text-stale.ts's; this Task copies another's context (no record of its text): the test-only switch leaves it out
    source = structuredClone(upd.ctx); E.testOnlySkipPrTextCheck = (x) => x.run.workflow === "merge-view";
    const mv = E.start({ workflow: "merge-view", text: "merge view" }); await until(() => !!openCard(mv) || ["succeeded", "failed"].includes(mv.status), 15000);
    const mc = openCard(mv), url = upd.ctx.pr.url;
    ok(mc?.title.en === `Pull request #${upd.ctx.pr.id} is open: merge it on GitHub` && mc.body.includes(`PR #${upd.ctx.pr.id} is open at ${url}; merging from Studio is off, so merge it on GitHub.`) && mc.sections["zh-TW"].why.includes(url) && mc.links.some((l: any) => l.href === url) && !/Remote verification stopped/.test(mc.title.en),
      "no operations grant: the merge card says the pull request is open and to merge it on GitHub, with its link (en and zh-TW)", `${mc?.title?.en} | ${mc?.body?.slice(0, 200)}`);
    await E.answer(mc.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(mv.status), 8000);

    // checkbox honesty: boxes the coordinator writes into a section become plain bullets (a template box or not); a copied heading is dropped
    sim.community.clear(); sim.community.set(".github/pull_request_template.md", TEMPLATE);
    answer = () => { const f = fill(); f.sections[0] = { heading: "Summary", text: "Euro prices.\n- [x] `bun run lint` passes\n- [X] Security audited\n## Checklist\n* [ ] Amounts stay integer cents end to end" }; return f; };
    const honest = await startRun("crew/honest"); const hc = openCard(honest), hb: string = hc?.pullRequest?.body ?? "";
    ok(hc?.title.en === "Open this pull request?" && hb.includes("- `bun run lint` passes") && hb.includes("- Security audited") && hb.includes("* Amounts stay integer cents end to end") && (hb.match(/^## Checklist$/gm) ?? []).length === 1
      && hb.includes("- [ ] `bun run lint` passes") && !/\[[xX]\] (`bun run lint`|Security)/.test(hb), "checkboxes inside section text become plain bullets; the template's lint box stays unchecked; a duplicated heading is dropped", hb.slice(0, 400));
    ok(/\[x\] `bun test` passes \(ci: firstmate\/ci passed at /.test(hc.body) && hc.pullRequest.proofs?.["`bun test` passes"]?.startsWith("ci:"), "the card names each tick's evidence id", hc.body.slice(0, 600));
    await E.answer(hc.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(honest.status), 8000);

    // several templates: the captain picks one
    sim.community.clear(); sim.community.set(".github/PULL_REQUEST_TEMPLATE/feature.md", TEMPLATE); sim.community.set(".github/PULL_REQUEST_TEMPLATE/fix.md", "## What broke\n\n<!-- the bug -->\n\n## Proof\n\n- [ ] A test reproduces it\n");
    answer = () => ({ title: "Fix it", sections: [{ heading: "What broke", text: "Euro prices." }] });
    const multi = await startRun("crew/multi");
    const pick = openCard(multi);
    ok(pick?.title.en === "Which pull request template?" && pick.captainOnly && pick.options.filter((o: any) => /^tpl-/.test(o.id)).length === 2, "several templates: the captain picks one on a card", JSON.stringify(pick?.options));
    await E.answer(pick.id, { choice: pick.options.find((o: any) => o.label.endsWith("fix.md")).id, by: "captain" } as any);
    await until(() => openCard(multi)?.id !== pick.id && !!openCard(multi), 10000);
    const chosen = openCard(multi);
    ok(chosen?.pullRequest?.template?.path === ".github/PULL_REQUEST_TEMPLATE/fix.md" && chosen.pullRequest.body.includes("## What broke") && chosen.pullRequest.body.includes("- [ ] A test reproduces it"), "the preview follows the picked template", chosen?.pullRequest?.body);
    await E.answer(chosen.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(multi.status), 8000);
    ok(multi.status === "succeeded" && multi.result === "closed" && !sim.head("crew/multi"), "close: nothing pushed", `${multi.status} ${multi.result}`);

    // a required input nobody can fill holds on a card
    sim.community.clear(); sim.community.set(".github/pull_request_template.md", "## Linked issue\n\n<!-- Required: the issue this closes -->\n\n## Summary\n\n<!-- what -->\n");
    answer = () => ({ title: "Euro", sections: [{ heading: "Summary", text: "Euro prices." }], missing: [{ field: "Linked issue", why: "The spec names no issue." }] });
    const held = await startRun("crew/held");
    const hold = openCard(held);
    ok(hold?.title.en === "The pull request needs your input" && hold.captainOnly && hold.body.includes("Linked issue") && !hold.pullRequest && !sim.head("crew/held"), "a required field nobody can fill holds on a captain card", hold?.title?.en);
    await E.answer(hold.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(held.status), 8000);
  } catch (e: any) { ok(false, "unexpected pull request flow error", e.stack); } finally { H.stop(); sim.stop(); }
}

// ---------- the test table renders each done line as clean text (R-069's done lines) ----------
{ const { parsePullTemplate, renderPullBody, acceptanceRow } = await import("../src/domain/pull-template");
  const done = [
    "In `test/format.test.ts`, the EUR cent-formatting scenario asserts that `format(123456, \"EUR\")` equals `€1.234,56`; planned fail-first: base returns `$1234.56` instead of the requested euro display.",
    "In `test/shop.test.ts`, the EUR conversion scenario asserts that a tea unit priced at 850 USD cents becomes 782 EUR cents at 1 USD = 0.92 EUR; planned fail-first: base leaves the amount at 850.",
    "In `test/shop.test.ts`, the EUR rendering scenario asserts euro product prices, basket line amounts, and total for `tea:1,mug:2`, including tea at `€7,82`, the mug line at `€22,08`, and total at `€29,90`; planned fail-first: base renders dollar amounts.",
    "In test/shop.test.ts, the static-build scenario observes a reachable euro page (planned fail-first: only USD and JPY pages).",
    "Unknown currencies keep the code prefix (test/codes.test.ts)",
    "Prices round half up. Planned fail-first: base truncates (test/round.test.ts)"];
  const rows = done.map((t) => ({ ...acceptanceRow(t), failsOnBase: "Yes (fail-first at 235859c5)" }));
  const b = renderPullBody(parsePullTemplate("## How it was tested\n\n| Acceptance line | Test | Fails on main |\n|---|---|---|\n|  |  |  |\n"), { text: {}, rows, proven: new Set() });
  const want = [
    "| The EUR cent-formatting scenario asserts that `format(123456, \"EUR\")` equals `€1.234,56` | test/format.test.ts | Yes (fail-first at 235859c5) |",
    "| The EUR conversion scenario asserts that a tea unit priced at 850 USD cents becomes 782 EUR cents at 1 USD = 0.92 EUR | test/shop.test.ts | Yes (fail-first at 235859c5) |",
    "| The EUR rendering scenario asserts euro product prices, basket line amounts, and total for `tea:1,mug:2`, including tea at `€7,82`, the mug line at `€22,08`, and total at `€29,90` | test/shop.test.ts | Yes (fail-first at 235859c5) |",
    "| The static-build scenario observes a reachable euro page | test/shop.test.ts | Yes (fail-first at 235859c5) |",
    "| Unknown currencies keep the code prefix | test/codes.test.ts | Yes (fail-first at 235859c5) |",
    "| Prices round half up | test/round.test.ts | Yes (fail-first at 235859c5) |"];
  const got = b.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Acceptance"));
  ok(JSON.stringify(got) === JSON.stringify(want), "each done line renders as its clean row: no 'In ``,' lead, no planned fail-first clause, balanced code spans", got.join("\n"));
  ok(got.every((l) => (l.match(/`/g) ?? []).length % 2 === 0) && !/``|planned fail-first|In `/i.test(b), "no empty or unbalanced code span and no spec wording is left in the table");
  const long = acceptanceRow("In `test/a.test.ts`, " + "the scenario observes `x` and ".repeat(12) + "ends.");
  ok(long.done.length <= 201 && long.done.endsWith("…") && (long.done.match(/`/g) ?? []).length % 2 === 0, "a long line is cut at a word outside a code span", long.done);
}

// ---------- table cells escape backslashes before pipes ----------
{ const { parsePullTemplate, renderPullBody } = await import("../src/domain/pull-template");
  const b = renderPullBody(parsePullTemplate("## Tests\n\n| Done | Test | Fails on main |\n|---|---|---|\n|  |  |  |\n"), { text: {}, rows: [{ done: "a \\| b", test: "t|u", failsOnBase: "x" }], proven: new Set() });
  ok(b.includes("| a \\\\\\| b | t\\|u | x |"), "a backslash before a pipe cannot unescape it in the test table", b); }

// ---------- 3. the code-firstmate graph is unchanged: pr-open after the build, remote-ready before the merge card ----------
const yaml = readFileSync(join(import.meta.dir, "../packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
ok(["[build, pr-open, ok]", "[pr-open, ci, ok]", "[pr-open, closed, close]", "[remote-ready, closed, close]", "do: remote.ready"].every((s) => yaml.includes(s)), "code-firstmate: pr-open after the build, remote-ready (where a template's pull request opens) before the merge card");
rmSync(temp, { recursive: true, force: true });
end();
