import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubProjectGrant } from "../src/adapters/github";
const adapters = await import("../src/adapters/github");
const { GitHubPrAdapter, LocalPrAdapter } = adapters;
const projectPrAdapter = (adapters as any).projectPrAdapter;
import { git, must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";
let passed = 0, failed = 0;
const ok = (v: any, name: string) => { console.log(`${v ? "PASS" : "FAIL"} ${name}`); v ? passed++ : failed++; };
const rejects = async (f: () => any, pattern: RegExp, name: string) => { try { await f(); ok(false, name); } catch (e: any) { ok(pattern.test(e.message) && !e.message.includes("fake-test-token"), name); } };
const temp = mkdtempSync(join(tmpdir(), "github-foundation-")), repo = join(temp, "source"), bare = join(temp, "remote.git");
mkdirSync(repo); setGitHome(join(temp, "data"));
must(repo, ["init", "-q", "-b", "main"]); writeFileSync(join(repo, "file"), "one"); must(repo, ["add", "file"]); must(repo, ["commit", "-qm", "one"]);
const initial = must(repo, ["rev-parse", "HEAD"]);
must(temp, ["clone", "--bare", "-q", repo, bare]); must(repo, ["checkout", "-qb", "crew/task"]);
writeFileSync(join(repo, "file"), "two"); must(repo, ["commit", "-qam", "two"]); const h1 = must(repo, ["rev-parse", "HEAD"]);
const sim = githubSimulator(bare);
const grant: GitHubProjectGrant = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "test-only-local-grant" };
const dir = (name: string) => { const p = join(temp, name); mkdirSync(p); return p; };
const req = { repo, base: "main", branch: "crew/task", head: h1, title: "Test spec", body: "Approved spec\n## Door\ntwo-way\n## Rollback\nrevert" };
const adapter = () => new GitHubPrAdapter(grant, () => "fake-test-token-do-not-leak", 200);
try {
  ok(typeof projectPrAdapter === "function", "explicit project adapter selection exists");
  if (typeof projectPrAdapter !== "function") {
    let opened = false; try { await adapter().open(req, dir("baseline")); opened = sim.head(req.branch) === h1; } catch {}
    ok(opened, "GitHub adapter performs a real lease-backed publication");
    throw new Error("BASE_MISSING_FOUNDATION");
  }
  ok(projectPrAdapter({ path: repo }, temp).id === "local", "registered projects stay local without explicit metadata");
  await rejects(() => projectPrAdapter({ path: repo, github: { ...grant, approvedAt: "" } }, temp), /approved/, "missing approval fails closed");
  await rejects(() => new GitHubPrAdapter({ ...grant, mode: "github" }, () => "fake"), /exact HTTPS/, "real mode refuses loopback or local remote");
  const mutable = { ...grant }; const pinned = new GitHubPrAdapter(mutable, () => "fake-test-token-do-not-leak"); mutable.repository = "foreign/project";
  ok(pinned.grant.repository === grant.repository && Object.isFrozen(pinned.grant), "approved remote target is snapshotted across asynchronous operations");
  const first = dir("first");
  const pr = await adapter().open(req, first);
  ok(sim.head(req.branch) === h1 && sim.head("main") === initial, "lease push creates actual bare ref without changing base");
  ok(pr.id === "1" && pr.adapter === "github" && JSON.parse(readFileSync(join(first, "pr.json"), "utf8")).head === h1, "open persists validated vendor PR after successful push");
  const again = await adapter().open(req, first);
  ok(again.id === pr.id && sim.pulls.size === 1, "restart open recovers same PR without duplicate");
  writeFileSync(join(repo, "file"), "three"); must(repo, ["commit", "-qam", "three"]); const h2 = must(repo, ["rev-parse", "HEAD"]);
  const next = await adapter().update({ ...pr, title: "Updated spec", body: req.body + " updated" }, h2, first);
  ok(next.id === pr.id && sim.head(req.branch) === h2 && sim.pulls.get(1).title === "Updated spec", "update preserves identity and publishes new head/body/title");
  must(bare, ["update-ref", "refs/heads/crew/task", initial]);
  await rejects(() => adapter().update(next, h1, first), /mismatch|lease/, "foreign remote head cannot be overwritten");
  ok(sim.head(req.branch) === initial && JSON.parse(readFileSync(join(first, "pr.json"), "utf8")).head === h2, "lease refusal retains real remote and recorded successful head");
  must(bare, ["update-ref", "refs/heads/crew/task", h2]);
  await rejects(() => adapter().open({ ...req, branch: "other/task" }, dir("naming")), /naming approval/, "out-of-prefix branch requires naming approval");
  await rejects(() => adapter().open({ ...req, base: "other" }, dir("base")), /target/, "base target cannot drift");
  await rejects(() => adapter().open({ ...req, repo: temp }, dir("path")), /target/, "ad hoc repository cannot use registered grant");
  await rejects(() => adapter().open({ ...req, head: "-bad" }, dir("sha")), /target/, "invalid head refused before Git or REST");
  await rejects(() => new GitHubPrAdapter(grant, () => null).open(req, dir("auth")), /authentication/, "missing authentication refuses publication");
  for (const status of [401, 403, 429]) {
    const d = dir(`error${status}`); sim.fail({ method: "GET", status, once: true });
    await rejects(() => adapter().open({ ...req, branch: `crew/error${status}` }, d), new RegExp(`GitHub ${status}`), `HTTP ${status} redacted and failed`);
    ok(!existsSync(join(d, "pr.json")) && !sim.head(`crew/error${status}`), `HTTP ${status} creates neither record nor remote branch`);
  }
  const partial = dir("partial"); sim.fail({ method: "POST", after: true, status: 503, once: true });
  await rejects(() => adapter().open({ ...req, branch: "crew/partial" }, partial), /GitHub 503/, "lost POST response fails honestly");
  ok(!existsSync(join(partial, "pr.json")) && sim.head("crew/partial") === h1, "partial push does not pretend PR success");
  const recovered = await adapter().open({ ...req, branch: "crew/partial" }, partial);
  ok(recovered.id === "2" && sim.pulls.size === 2, "lost POST recovery finds durable same PR");
  const timeout = dir("timeout"); sim.fail({ method: "GET", delay: 500, once: true });
  await rejects(() => adapter().open({ ...req, branch: "crew/timeout" }, timeout), /timed out/, "bounded request timeout fails honestly");
  ok(!existsSync(join(timeout, "pr.json")) && !sim.head("crew/timeout"), "timeout creates no false record or ref");
  ok(sim.calls.every(c => !/reviews|comments/.test(c.path)), "adapter never calls review or comment endpoints");
  for (const [method, path, body] of [["POST", "/pulls/1/reviews", {}], ["POST", "/issues/1/comments", {}], ["DELETE", "/pulls/1", {}], ["POST", "/pulls", { title: "x", body: "x", head: "crew/task", base: "main", surprise: true }], ["GET", "/pulls?state=open&head=fixture%3Acrew%2Ftask&base=main&per_page=100&unknown=1", null]] as const) {
    const r = await fetch(sim.origin + "/repos/fixture/project" + path, { method, ...(body !== null ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    ok(r.status === 422, `strict simulator rejects ${method} ${path}`);
  }

  const allowedProbe = adapter() as any; const callCount = sim.calls.length;
  for (const [method, path, body] of [["POST", "/pulls/1/reviews", {}], ["PATCH", "/issues/1/comments", {}], ["DELETE", "/pulls/1", {}], ["POST", "/pulls", { title: "x", body: "x", head: "crew/x", base: "main", unknown: "x" }]]) await rejects(() => allowedProbe.api(method, path, body), /allowlisted/, `adapter allowlist rejects ${method} ${path}`);
  ok(sim.calls.length === callCount, "forbidden endpoints never reach HTTP transport");
  const moved = must(repo, ["rev-parse", "HEAD"]);
  const bin = dir("git-bin"), realGit = Bun.which("git")!;
  const wrapper = join(bin, "git");
  writeFileSync(wrapper, `#!/bin/sh\ncase " $* " in *" push --porcelain "*) "${realGit}" -C "${bare}" update-ref refs/heads/crew/task "${initial}" ;; esac\nexec "${realGit}" "$@"\n`); chmodSync(wrapper, 0o700);
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = bin + ":" + oldPath;
    await rejects(() => adapter().update(next, h1, first), /lease check failed/, "remote changes after ls-remote are rejected by actual force-with-lease");
    ok(sim.head("crew/task") === initial && JSON.parse(readFileSync(join(first, "pr.json"), "utf8")).head === h2, "late lease race retains foreign ref and successful record");
  } finally { process.env.PATH = oldPath; must(bare, ["update-ref", "refs/heads/crew/task", h2]); }
  const decoy = join(temp, "decoy.git"); must(temp, ["clone", "--bare", "-q", repo, decoy]);
  must(repo, ["config", `url.${decoy}.insteadOf`, bare]);
  const injectedKeys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"], previousEnv = injectedKeys.map(k => process.env[k]);
  process.env.GIT_CONFIG_COUNT = "1"; process.env.GIT_CONFIG_KEY_0 = `url.${decoy}.insteadOf`; process.env.GIT_CONFIG_VALUE_0 = bare;
  try {
    await adapter().open({ ...req, branch: "crew/config-isolation" }, dir("config-isolation"));
    ok(sim.head("crew/config-isolation") === h1 && !git(decoy, ["show-ref", "--verify", "refs/heads/crew/config-isolation"]).ok, "project and ambient Git URL rewrites cannot redirect approved publication");
  } finally { injectedKeys.forEach((k, i) => { if (previousEnv[i] === undefined) delete process.env[k]; else process.env[k] = previousEnv[i]; }); must(repo, ["config", "--unset", `url.${decoy}.insteadOf`]); }
  const busyDir = dir("busy"); const busyAdapter = adapter(); sim.fail({ method: "GET", delay: 80, status: 503, once: true });
  const pending = busyAdapter.open({ ...req, branch: "crew/busy" }, busyDir).catch(() => null);
  await rejects(() => busyAdapter.open({ ...req, branch: "crew/busy" }, busyDir), /in progress/, "concurrent publication on same adapter is held"); await pending;
  for (const [label, mutate] of [["head", (p: any) => ({ ...p, head: { ...p.head, sha: initial } })], ["body", (p: any) => ({ ...p, body: "wrong" })], ["id", (p: any) => ({ ...p, number: "99" })]] as const) {
    const d = dir(`invalid-${label}`); sim.transformNext("POST", mutate);
    await rejects(() => adapter().open({ ...req, branch: `crew/invalid-${label}` }, d), /mismatch|invalid/, `malformed vendor ${label} response fails closed`);
    ok(!existsSync(join(d, "pr.json")), `malformed ${label} creates no success record`);
  }
  sim.fail({ method: "PATCH", status: 503, once: true });
  await rejects(() => adapter().update(next, h1, first), /GitHub 503/, "failed PATCH preserves previous successful PR record");
  ok(JSON.parse(readFileSync(join(first, "pr.json"), "utf8")).head === h2 && sim.head("crew/task") === h1, "partial update distinguishes pushed ref from recorded PR success");
  const updateRecovered = await adapter().update(next, h1, first);
  ok(updateRecovered.id === next.id && updateRecovered.head === h1, "restart update recovers same PR after partial push");
  const fakeSha = "a".repeat(40);
  sim.expect("GET", `/commits/${fakeSha}/check-runs?per_page=100`, { total_count: 0, check_runs: [] });
  sim.expect("GET", `/commits/${fakeSha}/status`, { state: "pending", statuses: [] });
  sim.expect("GET", "/pulls/1/reviews", []); sim.expect("GET", "/pulls/1/comments", []);
  for (const p of [`/commits/${fakeSha}/check-runs?per_page=100`, `/commits/${fakeSha}/status`, "/pulls/1/reviews", "/pulls/1/comments"]) ok((await fetch(sim.origin + "/repos/fixture/project" + p)).status === 200, `explicit future read fixture ${p}`);
  sim.expectJobLogs(1, "byte log", "bytes=0-7");
  const redirect = await fetch(sim.origin + "/repos/fixture/project/actions/jobs/1/logs", { redirect: "manual" });
  ok(redirect.status === 302 && redirect.headers.get("location")?.startsWith(sim.origin), "job log API returns documented local redirect");
  const logUrl = redirect.headers.get("location")!;
  const byteLog = await fetch(logUrl, { headers: { Range: "bytes=0-7" } });
  ok(byteLog.status === 206 && byteLog.headers.get("content-range") === "bytes 0-7/8" && await byteLog.text() === "byte log", "job log download honors exact byte Range");
  ok((await fetch(logUrl)).status === 422, "job log download refuses absent range");
  sim.expect("PUT", "/pulls/1/update-branch", { message: "Updating pull request branch.", url: "fixture" }, { expected_head_sha: fakeSha }, 202);
  sim.expect("PUT", "/pulls/1/merge", { sha: fakeSha, merged: true, message: "Pull Request successfully merged" }, { sha: fakeSha, merge_method: "squash" });
  ok((await fetch(sim.origin + "/repos/fixture/project/pulls/1/merge", { method: "PUT", body: JSON.stringify({ sha: fakeSha, merge_method: "squash", surprise: true }) })).status === 422, "future merge fixture refuses unknown body arguments");
  const advanced = must(repo, ["commit-tree", must(repo, ["rev-parse", `${h1}^{tree}`]), "-p", initial, "-m", "advance fixture base"]);
  must(repo, ["push", bare, `${advanced}:refs/heads/main`]);
  sim.expect("PUT", "/pulls/2/update-branch", { message: "Updating pull request branch.", url: "fixture" }, { expected_head_sha: h1 }, 202);
  const updatedBranch = await fetch(sim.origin + "/repos/fixture/project/pulls/2/update-branch", { method: "PUT", body: JSON.stringify({ expected_head_sha: h1 }) });
  const updatedHead = sim.head("crew/partial")!;
  ok(updatedBranch.status === 202 && updatedHead !== h1 && git(bare, ["merge-base", "--is-ancestor", advanced, updatedHead]).ok, "simulator update-branch integrates real bare base commit");
  sim.expect("PUT", "/pulls/2/merge", { merged: true, message: "Pull Request successfully merged" }, { sha: updatedHead, merge_method: "merge" });
  const merged = await (await fetch(sim.origin + "/repos/fixture/project/pulls/2/merge", { method: "PUT", body: JSON.stringify({ sha: updatedHead, merge_method: "merge" }) })).json();
  ok(merged.merged === true && merged.sha === sim.head("main") && sim.pulls.get(2).state === "closed" && git(bare, ["merge-base", "--is-ancestor", updatedHead, merged.sha]).ok, "simulator merge changes actual bare base and closes exact PR");
  await rejects(() => sim.expect("POST", "/pulls/1/reviews", {}), /unsupported/, "simulator cannot enable review posts");
  const localDir = dir("local"); const local = await new LocalPrAdapter().open(req, localDir); ok(local.adapter === "local" && local.url === null, "local review adapter remains functional");
  ok(must(repo, ["rev-parse", "HEAD"]) === h2 && !must(repo, ["status", "--porcelain"]), "source repository refs and working tree unchanged by all remote operations");
  const { installCode } = await import("../src/domain/code");
  const { Projects } = await import("../src/doors");
  const projectData = dir("project-data");
  writeFileSync(join(projectData, "projects.json"), JSON.stringify([{ id: "fixture", name: "fixture", path: repo, base: "main", sensitive: [], proposed: null, approvedAt: null, proposedAt: null, github: grant }]));
  const projects = new Projects(projectData);
  const E: any = { deps: { protectedRoots: [], agents: {} }, actions: {}, artifacts: {}, needs: {}, natives: {}, modes: {}, cardBodies: {}, expand: {}, doneLines: {}, instructions: {}, trusted: () => ({ ok: false, entries: [] }), onCancel: [], onDelete: [] };
  installCode(E, { dataDir: projectData, projects });
  const oldToken = process.env.CREW_GITHUB_TOKEN, oldCli = process.env.CREW_GH_NO_CLI;
  process.env.CREW_GITHUB_TOKEN = "fake-test-token-do-not-leak"; process.env.CREW_GH_NO_CLI = "1";
  try {
    sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [], contexts: [] });
    const x: any = { policy: (_p: string, d: any) => d, ctx: { repo, worktree: repo, project: "fixture", base: "main", branch: "crew/action", door: { door: "two-way" }, spec: { title: "Workflow spec", what: "Read locally", why: ["proof"], done: ["pass"], scope: ["file"], rollback: "revert fixture" } }, dir: dir("action"), rn: {}, run: { title: "Workflow" } };
    const remoteWait = await E.actions["pr.open"](x);
    ok(remoteWait.wait && remoteWait.external?.version === 1 && remoteWait.external?.pr.head === h2, "remote publication enters persisted head-bound verification wait");
    ok(x.ctx.pr?.adapter === "github" && sim.head("crew/action") === h2, "pr.open selects explicitly configured project adapter and pushes run head");
    ok(x.ctx.pr?.body.includes("## Door\ntwo-way") && x.ctx.pr?.body.includes("## Rollback\nrevert fixture") && x.ctx.pr?.body.includes("Workflow spec"), "workflow publication includes approved spec, door and rollback");
    await rejects(() => E.actions["git.merge"](x), /bound captain merge intent/, "published GitHub run cannot falsely complete through local merge");
    const projectFile = join(projectData, "projects.json"), originalProjects = readFileSync(projectFile, "utf8");
    const withoutGrant = JSON.parse(originalProjects); delete withoutGrant[0].github; writeFileSync(projectFile, JSON.stringify(withoutGrant));
    await rejects(() => E.actions["pr.open"](x), /authority changed/, "removing project grant cannot silently update a GitHub PR locally");
    writeFileSync(projectFile, originalProjects);
    await rejects(() => E.actions["git.merge"]({ ...x, ctx: { ...x.ctx, pr: undefined } }), /remote project has no verified PR/, "old/custom workflow cannot locally merge an opted-in GitHub project without publication");
    const loose: any = { ...x, ctx: { ...x.ctx, project: undefined, pr: undefined, branch: "crew/ad-hoc" }, dir: dir("ad-hoc"), rn: {} };
    const previousCalls = sim.calls.length; await E.actions["pr.open"](loose);
    ok(loose.ctx.pr?.adapter === "local" && sim.calls.length === previousCalls && !sim.head("crew/ad-hoc"), "ad hoc repo cannot infer remote authority from existing project config");
  } finally { if (oldToken === undefined) delete process.env.CREW_GITHUB_TOKEN; else process.env.CREW_GITHUB_TOKEN = oldToken; if (oldCli === undefined) delete process.env.CREW_GH_NO_CLI; else process.env.CREW_GH_NO_CLI = oldCli; }
  const yaml = readFileSync(join(import.meta.dir, "../packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
  ok(yaml.includes("do: pr.open") && yaml.includes("[build, pr-open, ok]") && yaml.includes("[pr-open, ci, ok]"), "code-firstmate publishes review request after build before CI");
} catch (e: any) { if (e.message !== "BASE_MISSING_FOUNDATION") { console.error(e.message); failed++; } } finally { sim.stop(); rmSync(temp, { recursive: true, force: true }); }
console.log(`${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
