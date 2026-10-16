import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The sandbox repository (unit sandbox-repo): data/demo-repo becomes money-kit, a
// small Bun + TypeScript library with bun test, GitHub templates, CONTRIBUTING
// (feature/ branches, Conventional Commits), CODEOWNERS, a CI workflow that runs on
// pull requests and on pushes to main and feature/**, a sensitive path (.github/**)
// and README_SANDBOX.md; Studio registers it as project "sandbox" with its policies.
//   bun tests/sandbox-repo.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
const run = (cwd: string, argv: string[], env: Record<string, string> = {}) => { const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } }); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
const data = checkedTempDir("crew-sbxrepo-");
// an older demo repo with history, as on the captain's machine
const repo = join(data, "demo-repo"); mkdirSync(repo);
run(repo, ["git", "init", "-q", "-b", "main"]); writeFileSync(join(repo, "NOTES.md"), "Notes.\n"); run(repo, ["git", "add", "-A"]); run(repo, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "Demo repository"]);
const r1 = prepareSandbox(data);
const f = (p: string) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), "utf8") : "");
ok(!!r1.committed && /^chore: /.test(run(repo, ["git", "log", "-1", "--format=%s"]).out) && run(repo, ["git", "rev-list", "--count", "HEAD"]).out.trim() === "2" && existsSync(join(repo, "NOTES.md")), "the sandbox lands on top of the existing history in one Conventional Commit");
ok(run(repo, ["git", "remote"]).out.trim() === "", "it is a standalone repository with no remote (the captain publishes it)");
const t = run(repo, ["bun", "test"]);
ok(t.code === 0 && /0 fail/.test(t.out) && /across 2 files/.test(t.out), "bun test passes on the library (two test files)", t.out.slice(-300));
ok(run(repo, ["bun", "run", "lint"]).code === 0, "bun run lint passes");
const sh = [0, 1].map((k) => run(repo, ["bun", "scripts/test-shard.ts"], { CREW_SHARD: String(k), CREW_SHARDS: "2" }));
ok(sh.every((s) => s.code === 0 && /Ran \d+ tests across 1 file/.test(s.out)) && JSON.parse(f(".crew/gates.json")).shards === 2, "the repository declares its test command, split into 2 shards, and each shard runs one file");
const ci = f(".github/workflows/ci.yml");
ok(/on:\s*\n\s*pull_request:/.test(ci) && /push:\s*\n\s*branches: \[main, "feature\/\*\*"\]/.test(ci) && /bun test/.test(ci), "CI runs on pull requests and on pushes to main and feature/** only", ci);
ok(/feature\/<short-name>/.test(f("CONTRIBUTING.md")) && /Conventional Commits/.test(f("CONTRIBUTING.md")), "CONTRIBUTING states the feature/ prefix and Conventional Commits");
ok(/^\*\s+@your-github-handle/m.test(f(".github/CODEOWNERS")) && /## What/.test(f(".github/pull_request_template.md")) && /## How it was tested/.test(f(".github/pull_request_template.md")) && /name: Bug report/.test(f(".github/ISSUE_TEMPLATE/bug_report.md")) && /name: Feature request/.test(f(".github/ISSUE_TEMPLATE/feature_request.md")), "CODEOWNERS, the PR template with its sections, and a bug and a feature issue template");
const rs = f("README_SANDBOX.md");
ok(/gh repo create <name> --private --source \. --push/.test(rs) && /git remote add origin/.test(rs) && /Actions/.test(rs) && /Require status checks to pass before merging: `test`/.test(rs) && /Doctor → GitHub/.test(rs) && /Register external repo/.test(rs), "README_SANDBOX.md gives the publish commands, Actions, branch protection with the test check, where the token goes, and how to register the repo");
ok(prepareSandbox(data).committed === null && run(repo, ["git", "rev-list", "--count", "HEAD"]).out.trim() === "2", "preparing again changes nothing");
registerSandbox(data);
const { Projects } = await import("../src/doors"); const { Policies } = await import("../src/runtime/checks");
const p = new Projects(data).get("sandbox"); const pol = new Policies(data);
ok(p?.path === repo && p.base === "main", "Studio registers it as project sandbox");
ok(pol.get("sensitive_paths", { project: "sandbox" }).value?.some((r: any) => r.glob === ".github/**") && pol.get("round_cap", { project: "sandbox" }).value === 3 && pol.get("branch_prefix", { project: "sandbox" }).value === "feature/" && pol.get("branch_prefix", { project: "sandbox" }).from === "project", "its project policies: .github/** is sensitive, round cap 3, branch prefix feature/");

// set up once: a commit the captain makes on main, and work they have not committed, survive a new start
writeFileSync(join(repo, ".github/CODEOWNERS"), "* @captain\n"); run(repo, ["git", "-c", "user.name=c", "-c", "user.email=c@c", "commit", "-qam", "chore: set the code owner"]);
writeFileSync(join(repo, "src/money.ts"), f("src/money.ts") + "// merged feature\n"); run(repo, ["git", "-c", "user.name=c", "-c", "user.email=c@c", "commit", "-qam", "feat: a merged feature"]);
writeFileSync(join(repo, "scratch.txt"), "work in progress\n");
const headBefore = run(repo, ["git", "rev-parse", "HEAD"]).out.trim();
ok(prepareSandbox(data).committed === null && run(repo, ["git", "rev-parse", "HEAD"]).out.trim() === headBefore && /@captain/.test(f(".github/CODEOWNERS")) && /merged feature/.test(f("src/money.ts")) && run(repo, ["git", "ls-files", "scratch.txt"]).out.trim() === "",
  "preparing again keeps the captain's commits (CODEOWNERS, a merged feature) and never commits their other work");
// Studio names the paths it commits: no `git add -A` (or `add .`) anywhere in Studio's code
{ const { readdirSync } = await import("node:fs");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|mjs|js)$/.test(e.name) && !e.name.endsWith(".gen.ts") ? [join(d, e.name)] : []);
  const hits = walk(join(import.meta.dir, "..", "src")).filter((x) => /["']add["'],\s*["'](-A|\.|--all)["']\s*\]|git add (-A|\.)(\s|$|")/.test(readFileSync(x, "utf8")));
  ok(!hits.length, "Studio's code never stages with git add -A: it names the paths it commits", hits.join(" ")); }

// project sensitive paths have one home, the project policy; doors and intake read it
{ const { classify, orgDefaults } = await import("../src/doors");
  const P = new Projects(data); const money = [{ path: "src/money.ts", added: 1 }];
  ok(classify(money, { defaults: orgDefaults(data), project: P.get("sandbox") }).door === "two-way", "src/money.ts is two-way before any rule");
  P.propose("sandbox", [{ glob: "src/money.ts", why: "the money maths" }]);
  ok(classify(money, { defaults: orgDefaults(data), project: P.get("sandbox") }).door === "two-way", "a proposed line does nothing until the captain approves it");
  P.approve("sandbox");
  const d = classify(money, { defaults: orgDefaults(data), project: P.get("sandbox") });
  ok(d.door === "one-way" && d.reasons.some((r) => r.list === "project" && r.glob === "src/money.ts") && pol.get("sensitive_paths", { project: "sandbox" }).value.some((r: any) => r.glob === "src/money.ts") && pol.get("sensitive_paths", { project: "sandbox" }).value.some((r: any) => r.glob === ".github/**"),
    "approving writes the line into the project policy (adding to .github/**); the door reads it from there", JSON.stringify(d.reasons));
  const raw = JSON.parse(readFileSync(join(data, "projects.json"), "utf8")); ok(raw.every((x: any) => !x.sensitive?.length), "projects.json keeps no second copy of the sensitive paths"); }

// Studio's git never runs the captain's global git setup (signing, hooks, templates)
{ const home = checkedTempDir("crew-home-"); const hooks = join(home, "hooks"); mkdirSync(hooks); const mark = join(home, "hook-ran");
  writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\ntouch ${mark}\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(home, ".gitconfig"), `[commit]\n\tgpgsign = true\n[core]\n\thooksPath = ${hooks}\n[user]\n\tsigningkey = NOPE\n`);
  const saved = { HOME: process.env.HOME, G: process.env.GIT_CONFIG_GLOBAL }; process.env.HOME = home; delete process.env.GIT_CONFIG_GLOBAL;
  const d2 = checkedTempDir("crew-sbxrepo-"); let err = ""; let r: any = null;
  try { r = prepareSandbox(d2); } catch (e: any) { err = e.message; }
  process.env.HOME = saved.HOME; if (saved.G) process.env.GIT_CONFIG_GLOBAL = saved.G;
  ok(!!r?.committed && !existsSync(mark), "with a global config that signs every commit and runs a failing hook, Studio's commit still lands and no hook runs", err); }

// the entry point: Studio's start sets up and registers the sandbox; CREW_SANDBOX=0 skips it; a restart keeps main
{ const { spawn } = await import("node:child_process");
  const boot = async (dir: string, extra: Record<string, string> = {}) => {
    const tmp = checkedTempDir("crew-sbxboot-"); for (const x of ["state", "home", "proj"]) mkdirSync(join(tmp, x));
    const port = await freePort();
    const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_DATA: dir, CREW_PORT: String(port), CREW_FM_STATE: join(tmp, "state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp, CREW_SESSION_TOKEN: "sbx", ...extra } });
    await waitUp(`http://127.0.0.1:${port}`, app);
    return { port, stop: async () => { app.kill(); await new Promise((res) => app.once("exit", res)); } };
  };
  const d1 = checkedTempDir("crew-sbxdata-");
  let s1 = await boot(d1); await s1.stop();
  const rp = join(d1, "demo-repo"); const prj = () => { try { return JSON.parse(readFileSync(join(d1, "projects.json"), "utf8")); } catch { return []; } };
  ok(existsSync(join(rp, ".git")) && prj().some((x: any) => x.id === "sandbox" && x.path === rp), "starting Studio sets up data/demo-repo and registers it as project sandbox");
  writeFileSync(join(rp, ".github/CODEOWNERS"), "* @captain\n"); run(rp, ["git", "-c", "user.name=c", "-c", "user.email=c@c", "commit", "-qam", "chore: set the code owner"]);
  const h = run(rp, ["git", "rev-parse", "HEAD"]).out.trim();
  new Policies(d1).setProject("sandbox", { sensitive_paths: [...new Policies(d1).project("sandbox").sensitive_paths, { glob: "src/money.ts", why: "the money maths" }] });
  s1 = await boot(d1);
  const ask = (project?: string) => fetch(`http://127.0.0.1:${s1.port}/api/intake`, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": "sbx" }, body: JSON.stringify({ text: "round the totals in src/money.ts", project }) }).then((x) => x.json()).catch(() => null);
  const r = await ask("sandbox"), r0 = await ask();
  // a run started for a project reads the project's resolved sensitive paths too
  const H2 = { "content-type": "application/json", "x-crew-session": "sbx" };
  // code-firstmate and coffee-kit refuse to start without an approved staffing configuration
  // (src/domain/staffing.ts installStaffingGuard); the classifier under test runs before any
  // workflow starts, so this uses the first catalog workflow that needs no staffing approval
  const wf = (await fetch(`http://127.0.0.1:${s1.port}/api/wf`).then((x) => x.json())).workflows?.find((w: any) => w.id !== "code-firstmate" && w.kind !== "coffee-kit")?.id;
  const run1 = await fetch(`http://127.0.0.1:${s1.port}/api/wruns`, { method: "POST", headers: H2, body: JSON.stringify({ text: "round the totals in src/money.ts", workflow: wf, params: { project: "sandbox" } }) }).then((x) => x.json()).catch(() => null);
  if (run1?.id) await fetch(`http://127.0.0.1:${s1.port}/api/wruns/${run1.id}/cancel`, { method: "POST", headers: H2, body: "{}" });
  // the staffing check resolves the project's repository identity (private roots) before it asks for an approval
  const code1 = await fetch(`http://127.0.0.1:${s1.port}/api/wruns`, { method: "POST", headers: H2, body: JSON.stringify({ text: "round the totals in src/money.ts", workflow: "code-firstmate", params: { project: "sandbox" } }) }).then((x) => x.json()).catch(() => null);
  await s1.stop();
  ok(!!wf && run1?.classifier?.door?.tier === "one-way", "a run started for a project (/api/wruns) reads the project's resolved sensitive paths", JSON.stringify([wf, run1?.classifier?.door, run1?.error]));
  ok(/Staffing approval/i.test(String(code1?.error ?? "")) && !/overlaps private or protected data|outside Studio private data/.test(String(code1?.error ?? "")), "the built-in sandbox at data/demo-repo is never refused as private Studio data when its code run starts (it reaches the staffing approval)", String(code1?.error ?? ""));
  ok(run(rp, ["git", "rev-parse", "HEAD"]).out.trim() === h && /@captain/.test(readFileSync(join(rp, ".github/CODEOWNERS"), "utf8")), "a commit on main survives a restart of Studio");
  ok(r?.door?.tier === "one-way" && r.door.reasons.some((x: any) => x.glob === "src/money.ts") && r0?.door?.tier === "two-way", "intake reads the project's resolved sensitive paths (org, then the project's own lines)", JSON.stringify([r?.door, r0?.door]));
  const d3 = checkedTempDir("crew-sbxdata-"); const s3 = await boot(d3, { CREW_SANDBOX: "0" }); await s3.stop();
  ok(!existsSync(join(d3, "demo-repo")) && !(existsSync(join(d3, "projects.json")) && JSON.parse(readFileSync(join(d3, "projects.json"), "utf8")).some((x: any) => x.id === "sandbox")), "CREW_SANDBOX=0 starts Studio without the sandbox"); }


// migrations of stored records
{ // (a) a sandbox set up by an older Studio (its setup commit, no mark) is recognised and left alone
  const d = checkedTempDir("crew-sbxold-"); const rp = join(d, "demo-repo"); mkdirSync(rp);
  run(rp, ["git", "init", "-q", "-b", "main"]); writeFileSync(join(rp, "README.md"), "old\n"); mkdirSync(join(rp, ".github"));
  writeFileSync(join(rp, ".github/CODEOWNERS"), "* @your-github-handle\n");
  run(rp, ["git", "add", "."]); run(rp, ["git", "-c", "user.name=s", "-c", "user.email=s@s", "commit", "-qm", "chore: set up money-kit as the sandbox repository"]);
  writeFileSync(join(rp, ".github/CODEOWNERS"), "* @captain\n"); run(rp, ["git", "-c", "user.name=c", "-c", "user.email=c@c", "commit", "-qam", "chore: set the code owner"]);
  const h = run(rp, ["git", "rev-parse", "HEAD"]).out.trim();
  const res = prepareSandbox(d);
  ok(res.committed === null && run(rp, ["git", "rev-parse", "HEAD"]).out.trim() === h && /@captain/.test(readFileSync(join(rp, ".github/CODEOWNERS"), "utf8")) && existsSync(join(rp, ".git", "crew-sandbox")), "an older sandbox setup is recognised by its setup commit and left alone (and marked)");
  // (b) a list approved before the policy was its home moves there once, and projects.json keeps no copy
  writeFileSync(join(d, "projects.json"), JSON.stringify([{ id: "legacy", name: "legacy", path: null, base: "main", sensitive: [{ glob: "src/x/**", why: "w" }], proposed: null, proposedAt: null, approvedAt: "2026-10-01" }]));
  const got = new Projects(d).get("legacy");
  ok(got?.sensitive.some((x) => x.glob === "src/x/**") && /src\/x\/\*\*/.test(readFileSync(join(d, "policies", "project-legacy.yaml"), "utf8")) && JSON.parse(readFileSync(join(d, "projects.json"), "utf8"))[0].sensitive.length === 0,
    "a list approved before the policy was its home moves there once, and projects.json keeps no copy"); }
// the org policy's sensitive paths reach the door
{ const { classify, orgDefaults } = await import("../src/doors");
  const d = checkedTempDir("crew-org-"); new Policies(d).setOrg({ sensitive_paths: [{ glob: "docs/**", why: "org" }] });
  const res = classify([{ path: "docs/a.md", added: 1 }], { defaults: orgDefaults(d) });
  ok(res.door === "one-way" && res.reasons.some((x) => x.list === "org" && x.glob === "docs/**"), "the org policy's sensitive paths reach the door (orgDefaults)", JSON.stringify(res.reasons)); }
// check sandboxes get no system or captain git config
{ const { sandboxed } = await import("../src/runtime/checks");
  const box = checkedTempDir("crew-sbxenv-"); mkdirSync(join(box, "out")); mkdirSync(join(box, "tmp"));
  const res = await sandboxed(["/usr/bin/env"], { cwd: box, out: join(box, "out"), tmp: join(box, "tmp"), timeoutS: 10, network: false });
  ok(/^GIT_CONFIG_NOSYSTEM=1$/m.test(res.stdout) && /^GIT_CONFIG_GLOBAL=\/dev\/null$/m.test(res.stdout), "check sandboxes get no system or captain git config", res.stdout.slice(0, 300) + (res.refused ?? "")); }
// changedPaths: deletions, renames, spaces and new files all reach the round commit
{ const { changedPaths, addPaths } = await import("../src/git");
  const d = checkedTempDir("crew-cp-"); run(d, ["git", "init", "-q", "-b", "main"]);
  writeFileSync(join(d, "a"), "a\n"); writeFileSync(join(d, "b c"), "b\n"); writeFileSync(join(d, "keep"), "k\n");
  run(d, ["git", "add", "."]); run(d, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
  run(d, ["git", "rm", "-q", "a"]); run(d, ["git", "mv", "b c", "d e"]); writeFileSync(join(d, "new f"), "n\n"); writeFileSync(join(d, "line\nbreak"), "x\n");
  (await import("node:fs")).symlinkSync("no-such-target", join(d, "dangling")); // a symlink that points nowhere is a new path, not a deletion
  const cp = changedPaths(d).sort();
  ok(JSON.stringify(cp) === JSON.stringify(["a", "b c", "d e", "dangling", "line\nbreak", "new f"].sort()), "changedPaths lists deletions, both sides of a rename, names with spaces and newlines, and new files", JSON.stringify(cp));
  addPaths(d, cp); const st = run(d, ["git", "status", "--porcelain"]).out;
  ok(!/^ D|^\?\?|^.[MD]/m.test(st) && /^A  dangling$/m.test(st), "addPaths stages every one of them, a dangling symlink included (nothing left unstaged or untracked)", st); }
// Studio's git never runs a hook it did not put there
{ const g = await import("../src/git");
  const d = checkedTempDir("crew-gh-"); g.setGitHome(d); g.gitPaths();
  const mark = join(d, "hook-ran"); writeFileSync(join(d, "git", "hooks", "pre-commit"), `#!/bin/sh\ntouch ${mark}\n`, { mode: 0o755 });
  const rp = checkedTempDir("crew-ghr-"); run(rp, ["git", "init", "-q", "-b", "main"]); writeFileSync(join(rp, "x"), "x\n");
  let e = ""; try { g.addPaths(rp, ["x"]); g.must(rp, ["commit", "-qm", "x"]); } catch (x: any) { e = x.message; }
  const mode = (await import("node:fs")).statSync(join(d, "git")).mode & 0o777;
  ok(!existsSync(mark) && /not empty/.test(e) && mode === 0o700, "a hook planted in Studio's hooks folder is refused, never run; the git home is private (0700)", `${e} ${mode.toString(8)}`);
  (await import("node:fs")).rmSync(join(d, "git", "hooks", "pre-commit")); }

console.log(`\nsandbox-repo: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
