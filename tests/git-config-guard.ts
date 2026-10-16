import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // scrubs inherited GIT_* first; repositories only in checked temp folders
// A broken shared git config (2026-10-16: core.bare=true in a checkout's .git/config) is named by the
// Doctor and refused before Studio makes or uses a task worktree; tests cannot write a parent repository's
// config through an inherited GIT_DIR; and a test that runs git config/init without a checked temp repo
// fails the lint. Every repository here is a throwaway under a checked temp folder.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
const ok = (v: unknown, name: string, detail = "") => { if (v) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `\n  ${String(detail).slice(0, 600)}` : ""}`); } };
const load = async (m: string) => { try { return await import(m); } catch (e: any) { console.log(`(cannot load ${m}: ${e?.message ?? e})`); return null; } };
const tmp = checkedTempDir("crew-git-config-guard-");
const clean = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } as Record<string, string>;
const sh = (cwd: string, ...args: string[]) => { assertTempRepo(cwd); const r = Bun.spawnSync(["git", ...args], { cwd, env: clean, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout.toString().trim(); };
/** a checkout with one commit and a linked worktree: the shape of Studio's checkout and of a project with task worktrees */
const checkout = (name: string) => {
  const main = join(tmp, name, "main"), linked = join(tmp, name, "linked"); mkdirSync(main, { recursive: true });
  sh(main, "init", "-q", "-b", "main"); writeFileSync(join(main, "README.md"), "fixture\n"); sh(main, "add", "README.md");
  sh(main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base"); sh(main, "worktree", "add", "-q", "-b", "side", linked);
  return { main, linked, config: join(main, ".git", "config") };
};
const breakConfig = (config: string, key: string, value: string) => sh(tmp, "config", "--file", config, key, value);

const health = await load("../src/git-config-health");
const doctor = await load("../src/doctor");
const wt = await load("../src/worktrees");
const gitMod = await load("../src/git");
gitMod?.setGitHome?.(join(tmp, "studio-git"));

// ---------- 1. the Doctor names the repository and the key ----------
{
  const c = checkout("doctor");
  const input = (gitConfig: any) => ({ state: join(tmp, "state"), legacy: false, board: { writable: false }, gh: { connected: false, tokenSource: null, enabled: false },
    keys: { anthropic: null, openai: null, compatBaseUrl: null }, chatProvider: "none", lanIp: null, tailscale: { installed: false, running: false, dnsName: null },
    claudeBin: "/nonexistent/claude", codexBin: "/nonexistent/codex", compiled: false, gitConfig });
  const report = () => health?.gitConfigReport?.([{ label: "project fixture", path: c.linked }, { label: "project fixture main", path: c.main }]);
  const sound = report();
  const soundItem = sound && doctor?.diagnose(input(sound)).find((i: any) => i.id === "git-config");
  ok(soundItem?.status === "ok" && sound.checked.length === 1, "a sound shared config is ok, and a checkout and its linked worktree are checked once", JSON.stringify(soundItem ?? sound));
  breakConfig(c.config, "core.bare", "true");
  const broken = report();
  const item = broken && doctor?.diagnose(input(broken)).find((i: any) => i.id === "git-config");
  ok(item?.status === "degraded" && item.detail.includes("project fixture") && item.detail.includes(c.linked) && item.detail.includes("core.bare=true"),
    "Doctor names the repository (label and path) and the key when its shared config has core.bare=true (seen from a linked worktree)", JSON.stringify(item));
  ok(item?.fix?.includes(`git config --file ${realpathSync(c.config)} core.bare false`) && readFileSync(c.config, "utf8").includes("bare = true"), "Doctor gives the manual fix and changes nothing", item?.fix);
  breakConfig(c.config, "core.bare", "false");
  breakConfig(c.config, "core.worktree", join(tmp, "elsewhere"));
  const wtp = health?.sharedGitConfigProblems?.(c.main, "x") ?? [];
  ok(wtp.length === 1 && wtp[0].key === "core.worktree", "an unexpected core.worktree is named", JSON.stringify(wtp));
  sh(tmp, "config", "--file", c.config, "--unset", "core.worktree");
  breakConfig(c.config, "core.hooksPath", join(tmp, "hooks-outside"));
  const hp = health?.sharedGitConfigProblems?.(c.linked, "x") ?? [];
  ok(hp.length === 1 && hp[0].key === "core.hooksPath" && hp[0].blocking === false, "a hooksPath outside the repository is named, as report-only", JSON.stringify(hp));
  let hpThrew: any = null; try { health?.assertSharedGitConfig(c.linked); } catch (e) { hpThrew = e; }
  ok(!!health && !hpThrew, "an out-of-repo hooksPath never refuses a worktree", hpThrew?.message);
  const hpItem = doctor?.diagnose(input(health?.gitConfigReport?.([{ label: "project fixture", path: c.linked }]))).find((i: any) => i.id === "git-config");
  ok(hpItem?.status === "degraded" && /core\.hooksPath/.test(hpItem.detail) && /reported only/.test(hpItem.detail), "the Doctor still reports it, as reported only", hpItem?.detail);
  breakConfig(c.config, "core.hooksPath", ".githooks");
  ok(health?.sharedGitConfigProblems?.(c.linked, "x")?.length === 0, "a hooksPath inside the repository is fine");
  sh(tmp, "config", "--file", c.config, "--unset", "core.hooksPath");
  // a core.bare that arrives only through include.path: reported, never refused
  writeFileSync(join(tmp, "doctor", "inc.cfg"), "[core]\n\tbare = true\n"); breakConfig(c.config, "include.path", join(tmp, "doctor", "inc.cfg"));
  const inc = health?.sharedGitConfigProblems?.(c.linked, "x") ?? [];
  let incThrew: any = null; try { health?.assertSharedGitConfig(c.linked); } catch (e) { incThrew = e; }
  ok(!!health && inc.length === 1 && inc[0].key === "core.bare" && inc[0].blocking === false && /include\.path/.test(inc[0].why) && !incThrew, "a core.bare set only through include.path is reported without blocking", JSON.stringify(inc) + (incThrew?.message ?? ""));
  sh(tmp, "config", "--file", c.config, "--unset", "include.path");
  // core.bare is read as git reads a boolean: a bad value is named and blocks (git itself refuses it)
  breakConfig(c.config, "core.bare", "maybe");
  const badBool = health?.sharedGitConfigProblems?.(c.linked, "x") ?? [];
  ok(badBool.length === 1 && badBool[0].key === "core.bare" && badBool[0].blocking && /not a boolean/.test(badBool[0].why), "a core.bare that is not a boolean is named and blocks", JSON.stringify(badBool));
  breakConfig(c.config, "core.bare", "0");
  ok(health?.sharedGitConfigProblems?.(c.linked, "x")?.length === 0, "core.bare=0 is false, as git reads it");
  breakConfig(c.config, "core.bare", "false");
  // per-worktree config: with extensions.worktreeConfig on, the checkout's own config.worktree is read too
  breakConfig(c.config, "extensions.worktreeConfig", "true");
  const linkedGitDir = readFileSync(join(c.linked, ".git"), "utf8").replace(/^gitdir:\s*/, "").trim();
  writeFileSync(join(linkedGitDir, "config.worktree"), "[core]\n\tbare = true\n");
  const perWt = health?.sharedGitConfigProblems?.(c.linked, "x") ?? [];
  ok(perWt.length === 1 && perWt[0].key === "core.bare" && perWt[0].blocking && perWt[0].config.endsWith("config.worktree"), "core.bare=true in the checkout's config.worktree is named when extensions.worktreeConfig is on", JSON.stringify(perWt));
  writeFileSync(join(linkedGitDir, "config.worktree"), ""); sh(tmp, "config", "--file", c.config, "--unset", "extensions.worktreeConfig");
  // a git that hangs (the registration test's held git) is reported as unchecked within the bound, never refused
  { const bin = join(tmp, "hung-bin"); mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, "git"), "#!/bin/sh\nexec /bin/sleep 30\n", { mode: 0o755 });
    const path0 = process.env.PATH; process.env.PATH = `${bin}:${path0}`; const t0 = Date.now(); let hung: any[] = [], hungThrew: any = null;
    try { hung = health?.sharedGitConfigProblems?.(c.linked, "x") ?? []; try { health?.assertSharedGitConfig(c.linked); } catch (e) { hungThrew = e; } } finally { process.env.PATH = path0; }
    const ms = Date.now() - t0;
    ok(!!health && hung.length === 1 && hung[0].unchecked && !hung[0].blocking && !hungThrew && ms < 10000, "a git that hangs is reported as unchecked within the time bound and never refuses", `${ms} ms ${JSON.stringify(hung)}`); }
  // the built-in sandbox (data/demo-repo) is a plain checkout: the same check reads it
  const data = join(tmp, "data"), demo = join(data, "demo-repo"); mkdirSync(demo, { recursive: true }); sh(demo, "init", "-q", "-b", "main"); breakConfig(join(demo, ".git", "config"), "core.bare", "true");
  const sb = health?.gitConfigReport?.([{ label: "built-in sandbox (data/demo-repo)", path: demo }]);
  ok(sb?.problems?.[0]?.label === "built-in sandbox (data/demo-repo)" && sb.problems[0].key === "core.bare", "the built-in sandbox at data/demo-repo is checked too", JSON.stringify(sb));
}

// ---------- 2. Studio refuses to make or use a task worktree on a broken shared config ----------
{
  const c = checkout("worktrees"); const data = join(tmp, "wt-data"); mkdirSync(data, { recursive: true });
  let refusal: any = null, made: any = null;
  if (wt) {
    const W = new wt.Worktrees(data);
    breakConfig(c.config, "core.bare", "true");
    try { made = W.ensure({ project: "demo", task: "R-001", repo: c.main, base: "main", branchPrefix: "feature/" }); } catch (e) { refusal = e; }
    ok(!made && refusal?.code === "shared_git_config_broken" && refusal?.outcome === "blocked" && /core\.bare/.test(refusal.message) && refusal.message.includes(c.main),
      "worktree creation refuses on a broken shared config, with a typed reason naming the repository and key", refusal?.message ?? JSON.stringify(made));
    ok(!existsSync(join(data, "work", "wt", "demo", "R-001")) && readFileSync(c.config, "utf8").includes("bare = true"), "nothing was created and the config was not changed");
    breakConfig(c.config, "core.bare", "false");
    const r = W.ensure({ project: "demo", task: "R-002", repo: c.main, base: "main", branchPrefix: "feature/" });
    ok(!!r && existsSync(r.path), "with the config sound again, the worktree is made");
    ok(refusal instanceof wt.RoundBlocked, "the refusal is a RoundBlocked, so the code workflow records a BLOCKED round (not a retried node error)");
    breakConfig(c.config, "core.hooksPath", "/usr/local/share/hooks-outside");
    let hpMade: any = null; try { hpMade = W.ensure({ project: "demo", task: "R-003", repo: c.main, base: "main", branchPrefix: "feature/" }); } catch (e: any) { hpMade = e; }
    ok(hpMade && !(hpMade instanceof Error) && existsSync(hpMade.path), "an out-of-repo hooksPath does not block a task worktree", hpMade?.message);
    sh(tmp, "config", "--file", c.config, "--unset", "core.hooksPath");
    breakConfig(c.config, "core.bare", "true");
    let roundErr: any = null; try { const s = await W.startRound("demo", "R-002", "fixture", { skipInstall: true }); s.release(); } catch (e) { roundErr = e; }
    ok(roundErr?.code === "shared_git_config_broken" && !existsSync(join(data, "work", "wt", "demo", "R-002.lock")), "a round on an existing worktree is refused before it takes the lock", roundErr?.message);
    breakConfig(c.config, "core.bare", "false");
  } else ok(false, "worktree creation refuses on a broken shared config (src/worktrees did not load)");
}

// ---------- 3. an inherited GIT_DIR never reaches a fixture repository's config ----------
{
  const target = checkout("gitdir-target"), control = checkout("gitdir-control");
  const before = readFileSync(target.config, "utf8"), controlBefore = readFileSync(control.config, "utf8");
  const helper = join(import.meta.dir, "lib", "git-hygiene.mjs"), studioGit = join(import.meta.dir, "..", "src", "git.ts");
  // what a test fixture does: git init a fresh folder, set config there, and the same through Studio's git
  const fixture = (withHelper: boolean, root: string) => `${withHelper ? `import ${JSON.stringify(helper)};` : ""}
    const {spawnSync}=await import("node:child_process");const {mkdirSync}=await import("node:fs");
    const repo=${JSON.stringify(root)}+"/repo",studio=${JSON.stringify(root)}+"/studio";mkdirSync(repo,{recursive:true});mkdirSync(studio,{recursive:true});
    spawnSync("git",["init","-q","-b","main"],{cwd:repo});spawnSync("git",["config","user.name","Fixture"],{cwd:repo}); // git-hygiene-lint: allow (the control run is deliberately unsafe)
    ${withHelper ? `const g=await import(${JSON.stringify(studioGit)});g.setGitHome(${JSON.stringify(root)}+"/home");g.must(studio,["init","-q","-b","main"]);g.must(studio,["config","user.name","Fixture"]);` : ""}`; // git-hygiene-lint: allow (fixture text for a child process)
  const run = (code: string, gitDir: string) => { const file = join(checkedTempDir("crew-gitdir-script-"), "fixture.mjs"); writeFileSync(file, code);
    return Bun.spawnSync([process.execPath, file], { env: { ...clean, GIT_DIR: gitDir }, stdout: "pipe", stderr: "pipe" }); };
  const gitDirOf = (linked: string) => readFileSync(join(linked, ".git"), "utf8").replace(/^gitdir:\s*/, "").trim();
  const a = checkedTempDir("crew-gitdir-a-"), b = checkedTempDir("crew-gitdir-b-");
  const res = run(fixture(true, a), gitDirOf(target.linked));
  ok(res.exitCode === 0 && readFileSync(target.config, "utf8") === before && existsSync(join(a, "repo", ".git")) && existsSync(join(a, "studio", ".git")),
    "with GIT_DIR pointed at a fixture repo, the test helpers and Studio's git leave its config unchanged and init their own folders", `exit ${res.exitCode} ${res.stderr}`);
  ok(!health || health.sharedGitConfigProblems(target.linked).length === 0, "the fixture repo's shared config is still sound");
  run(fixture(false, b), gitDirOf(control.linked));
  ok(readFileSync(control.config, "utf8") !== controlBefore && /bare = true/.test(readFileSync(control.config, "utf8")),
    "control: the same fixture without the helper rewrites the GIT_DIR repository's config (core.bare=true), as on 2026-10-16");
  const env = gitMod?.gitEnv ? (() => { process.env.GIT_DIR = "/nonexistent/.git"; process.env.GIT_WORK_TREE = "/nonexistent"; try { return gitMod.gitEnv(); } finally { delete process.env.GIT_DIR; delete process.env.GIT_WORK_TREE; } })() : { GIT_DIR: "x" };
  ok(!("GIT_DIR" in env) && !("GIT_WORK_TREE" in env), "Studio's gitEnv never passes an inherited GIT_DIR or GIT_WORK_TREE on");
  let refused = 0; for (const p of ["", "relative/path", "/", join(import.meta.dir, "..", "tmp-repo")]) { try { assertTempRepo(p); } catch { refused++; } }
  ok(refused === 4, "assertTempRepo refuses an empty, relative, root or in-checkout path");
}

// ---------- 3b. the clean restart: runs once, keeps signals and their exit codes ----------
{
  const { spawn } = await import("node:child_process");
  const helper = join(import.meta.dir, "lib", "git-hygiene.mjs");
  const start = (dir: string, code: string, env: Record<string, string> = {}) => { writeFileSync(join(dir, "s.mjs"), `import ${JSON.stringify(helper)};\n${code}`);
    return spawn(process.execPath, ["s.mjs"], { cwd: dir, env: { ...clean, GIT_DIR: "/nonexistent-gcg/.git", ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); };
  const finish = (p: any, ms: number) => new Promise<{ code: number | null; signal: string | null; out: string; timedOut: boolean }>((res) => { let out = "", timedOut = false;
    p.stdout.on("data", (d: any) => { out += d; }); p.stderr.on("data", (d: any) => { out += d; });
    const t = setTimeout(() => { timedOut = true; try { process.kill(-p.pid, "SIGKILL"); } catch {} }, ms);
    p.on("exit", (code: number | null, signal: string | null) => { clearTimeout(t); setTimeout(() => res({ code, signal, out, timedOut }), 50); }); });
  // a .env that Bun loads at every start puts GIT_DIR back: the restart must still happen once, never again
  const envDir = checkedTempDir("crew-gcg-dotenv-"); writeFileSync(join(envDir, ".env"), "GIT_DIR=/nonexistent-gcg/.git\n");
  const r1 = await finish(start(envDir, `console.log("ran " + (process.env.CREW_GIT_HYGIENE_REEXEC ?? "first"));`), 3000);
  const runs = (r1.out.match(/^ran /gm) ?? []).length;
  ok(!r1.timedOut && r1.code === 0 && runs === 1 && /ran done/.test(r1.out), "a .env that re-injects GIT_DIR restarts the test once, not recursively", `timedOut=${r1.timedOut} code=${r1.code} runs=${runs} ${r1.out.slice(0, 300)}`);
  // with the env-isolation helper first (its own clean restart: BUN_OPTIONS=--no-env-file, CREW_TEST_ENV_ISOLATED),
  // the two restarts never fight: one "ran", exit 0, GIT_DIR gone
  const isolated = join(import.meta.dir, "lib", "isolated-env.mjs");
  if (existsSync(isolated)) {
    const both = checkedTempDir("crew-gcg-both-"); writeFileSync(join(both, ".env"), "GIT_DIR=/nonexistent-gcg/.git\n");
    writeFileSync(join(both, "s.mjs"), `import ${JSON.stringify(isolated)};\nimport ${JSON.stringify(helper)};\nconsole.log("ran " + (process.env.GIT_DIR ?? "clean"));`);
    const rb = await finish(spawn(process.execPath, ["s.mjs"], { cwd: both, env: { ...clean, GIT_DIR: "/nonexistent-gcg/.git" }, stdio: ["ignore", "pipe", "pipe"], detached: true }), 5000);
    const n = (rb.out.match(/^ran /gm) ?? []).length;
    ok(!rb.timedOut && rb.code === 0 && n === 1 && /ran clean/.test(rb.out), "with isolated-env.mjs first, the two clean restarts run once each and the test sees no GIT_DIR", `timedOut=${rb.timedOut} code=${rb.code} runs=${n} ${rb.out.slice(0, 300)}`);
  } else console.log("SKIP isolated-env.mjs is not on this branch: the combined restart is checked once it lands");
  // a run killed by a signal exits 128+n
  const plain = checkedTempDir("crew-gcg-signal-");
  const r2 = await finish(start(plain, `process.kill(process.pid, "SIGKILL");`), 8000);
  ok(r2.code === 137, "a restarted run killed by SIGKILL makes the test exit 137 (128+9), not 1", `code=${r2.code} signal=${r2.signal}`);
  // SIGTERM to the test reaches the restarted run
  const pidFile = join(plain, "child.pid");
  const p3 = start(plain, `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setTimeout(() => {}, 30000);`);
  const done3 = finish(p3, 15000);
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await Bun.sleep(50);
  const childPid = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8") : 0);
  try { process.kill(p3.pid!, "SIGTERM"); } catch {}
  const r3 = await done3; await Bun.sleep(100);
  const alive = (pid: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
  const childAlive = alive(childPid); if (childAlive) try { process.kill(childPid, "SIGKILL"); } catch {}
  ok(childPid > 0 && !childAlive && r3.code === 143, "SIGTERM to the test is forwarded to the restarted run, and the test exits 143", `child=${childPid} alive=${childAlive} code=${r3.code} signal=${r3.signal}`);
}

// ---------- 2b. Studio's startup output warns, names the repository and changes nothing ----------
{
  const { spawn } = await import("node:child_process"); const { freePort, waitUp } = await import("./boot.mjs");
  const root = checkedTempDir("crew-gcg-boot-"), data = join(root, "data"), demo = join(data, "demo-repo");
  for (const x of ["state", "home", "proj"]) mkdirSync(join(root, x), { recursive: true }); mkdirSync(demo, { recursive: true });
  sh(demo, "init", "-q", "-b", "main"); breakConfig(join(demo, ".git", "config"), "core.bare", "true"); const before = readFileSync(join(demo, ".git", "config"), "utf8");
  const port = await freePort(); let out = "";
  const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_DATA: data, CREW_PORT: String(port), CREW_FM_STATE: join(root, "state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", HOME: join(root, "home"), CREW_MAIN_PROJECT: join(root, "proj"), CREW_FILE_ALLOW: root, CREW_SESSION_TOKEN: "gcg" } });
  app.stdout!.on("data", (d) => { out += d; }); app.stderr!.on("data", (d) => { out += d; });
  try { await waitUp(`http://127.0.0.1:${port}`, app); } catch (e: any) { out += String(e?.message ?? e); }
  app.kill(); await new Promise((r) => app.once("exit", r));
  ok(/WARNING broken shared git config in built-in sandbox \(data\/demo-repo\)/.test(out) && out.includes("core.bare=true") && out.includes(demo),
    "Studio's startup output warns about a broken shared config, naming the repository and the key", out.split("\n").filter((l) => /git config|demo-repo/.test(l)).join("\n") || out.slice(-800));
  ok(readFileSync(join(demo, ".git", "config"), "utf8") === before, "startup only reports: the broken config is left as it was");
}

// ---------- 4. the lint: no test runs git config without a checked temp repo ----------
{
  const lint = await load("./lib/git-hygiene-lint.mjs");
  const planted = `import {spawnSync} from "node:child_process";const dir=process.env.FIXTURE_DIR||"";spawnSync("git",["-C",dir,"config","core.bare","true"]);`; // git-hygiene-lint: allow (planted sample)
  const plantedFindings = lint?.lintGitHygieneText?.("planted-unsafe.ts", planted) ?? [];
  ok(plantedFindings.some((f: any) => f.rule === "checked-temp-repo") && plantedFindings.some((f: any) => f.rule === "imports-hygiene"), "the lint catches a planted test that runs git config without a checked temp repo", JSON.stringify(plantedFindings));
  const shell = lint?.lintGitHygieneText?.("planted.mjs", `execSync("cd $T && git config core.bare true")`) ?? [];
  ok(shell.some((f: any) => f.rule === "checked-temp-repo"), "the lint reads git config in a shell string too", JSON.stringify(shell));
  const safe = lint?.lintGitHygieneText?.("safe.ts", `import {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-");must(d,["init","-q"]);must(d,["config","user.name","x"]);`) ?? [null];
  ok(safe.length === 0, "a test that builds its repo in a checked temp folder passes", JSON.stringify(safe));
  const L = (name: string, text: string) => lint?.lintGitHygieneText?.(name, text) ?? [{ rule: "missing" }];
  const commented = L("c.ts", `// import "./lib/git-hygiene.mjs";\nimport {checkedTempDir} from "./x";const d=checkedTempDir("x-");must(d,["init","-q"]);`); // git-hygiene-lint: allow
  ok(commented.some((f: any) => f.rule === "imports-hygiene"), "a commented-out hygiene import does not count", JSON.stringify(commented));
  const late = L("l.ts", `import {x} from "./x";\nimport {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-");must(d,["init","-q"]);`); // git-hygiene-lint: allow
  ok(late.some((f: any) => f.rule === "imports-hygiene"), "the hygiene import must be the first line", JSON.stringify(late));
  const afterEnv = L("e.ts", `import "./lib/isolated-env.mjs"; // first\nimport {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-");must(d,["init","-q"]);`);
  ok(afterEnv.length === 0, "the hygiene import may be line 2, right after the env-isolation import", JSON.stringify(afterEnv));
  const line2 = L("e2.ts", `import {x} from "./x";\nimport {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-");must(d,["init","-q"]);`); // git-hygiene-lint: allow
  ok(line2.some((f: any) => f.rule === "imports-hygiene"), "line 2 only counts after the env-isolation import", JSON.stringify(line2));
  const cwd = L("w.ts", `import {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-");must(process.cwd(),["init","-q"]);`); // git-hygiene-lint: allow
  ok(cwd.some((f: any) => f.rule === "checked-temp-repo" && /current folder/.test(f.why)), "git init in process.cwd() fails even when the file has a checked temp dir", JSON.stringify(cwd));
  const unchecked = L("u.ts", `import {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-"),other=process.env.REPO;must(other,["config","user.name","x"]);`); // git-hygiene-lint: allow
  ok(unchecked.some((f: any) => f.rule === "checked-temp-repo" && /other/.test(f.why)), "git config in an unchecked variable fails even when the file has a checked temp dir", JSON.stringify(unchecked));
  const viaJoin = L("j.ts", `import {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-"),repo=join(d,"repo");const r2=repo;sh(r2,"git","init","-q");`);
  ok(viaJoin.length === 0, "a repo joined under a checked temp dir (or an alias of one) passes", JSON.stringify(viaJoin));
  const prose = L("p.ts", `const steps=["init","config","start"];const words=["config","init"];console.log(steps,words);`);
  ok(prose.length === 0, "a prose array of words is not a git call", JSON.stringify(prose));
  const all = lint?.lintGitHygiene?.(import.meta.dir) ?? [null];
  ok(all.length === 0, "every test under tests/ follows the git hygiene rules", JSON.stringify(all.slice(0, 5)));
}

console.log(`git-config-guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
