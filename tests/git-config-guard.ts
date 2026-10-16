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
  ok(hp.length === 1 && hp[0].key === "core.hooksPath", "a hooksPath outside the repository is named", JSON.stringify(hp));
  breakConfig(c.config, "core.hooksPath", ".githooks");
  ok(health?.sharedGitConfigProblems?.(c.linked, "x")?.length === 0, "a hooksPath inside the repository is fine");
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
    spawnSync("git",["init","-q","-b","main"],{cwd:repo});spawnSync("git",["config","user.name","Fixture"],{cwd:repo});
    ${withHelper ? `const g=await import(${JSON.stringify(studioGit)});g.setGitHome(${JSON.stringify(root)}+"/home");g.must(studio,["init","-q","-b","main"]);g.must(studio,["config","user.name","Fixture"]);` : ""}`;
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
  const planted = `import {spawnSync} from "node:child_process";const dir=process.env.FIXTURE_DIR||"";spawnSync("git",["-C",dir,"config","core.bare","true"]);`;
  const plantedFindings = lint?.lintGitHygieneText?.("planted-unsafe.ts", planted) ?? [];
  ok(plantedFindings.some((f: any) => f.rule === "checked-temp-repo") && plantedFindings.some((f: any) => f.rule === "imports-hygiene"), "the lint catches a planted test that runs git config without a checked temp repo", JSON.stringify(plantedFindings));
  const shell = lint?.lintGitHygieneText?.("planted.mjs", `execSync("cd $T && git config core.bare true")`) ?? [];
  ok(shell.some((f: any) => f.rule === "checked-temp-repo"), "the lint reads git config in a shell string too", JSON.stringify(shell));
  const safe = lint?.lintGitHygieneText?.("safe.ts", `import {checkedTempDir} from "./lib/git-hygiene.mjs";const d=checkedTempDir("x-");must(d,["init","-q"]);must(d,["config","user.name","x"]);`) ?? [null];
  ok(safe.length === 0, "a test that builds its repo in a checked temp folder passes", JSON.stringify(safe));
  const all = lint?.lintGitHygiene?.(import.meta.dir) ?? [null];
  ok(all.length === 0, "every test under tests/ follows the git hygiene rules", JSON.stringify(all.slice(0, 5)));
}

console.log(`git-config-guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
