import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Adversarial Git helpers remain local, own a bounded lifetime, and report only
// fixture PIDs/PGIDs. No real credentials, repositories or remote are used.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubPrAdapter, type GitHubProjectGrant } from "../src/adapters/github";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";
let passed = 0, failed = 0;
const ok = (v: any, name: string) => { console.log(`${v ? "PASS" : "FAIL"} ${name}`); v ? passed++ : failed++; };
const temp = checkedTempDir("github-process-"), repo = join(temp, "repo"), bare = join(temp, "remote.git"), bin = join(temp, "bin");
mkdirSync(repo); mkdirSync(bin); setGitHome(join(temp, "data"));
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "fixture"); must(repo, ["add", "file"]); must(repo, ["commit", "-qm", "fixture"]);
const head = must(repo, ["rev-parse", "HEAD"]); must(temp, ["clone", "--bare", "-q", repo, bare]);
const realGit = Bun.which("git")!, originalPath = process.env.PATH;
const sim = githubSimulator(bare);
const grant: GitHubProjectGrant = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "fixture-process-cleanup" };
const info = (pid: number) => { const r = Bun.spawnSync(["/bin/ps", "-o", "pid=,pgid=,stat=", "-p", String(pid)]); const row = r.stdout.toString().trim().split(/\s+/); return { pid: Number(row[0]), group: Number(row[1]), running: r.success && row.length > 2 && !row[2].startsWith("Z") }; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
try {
  for (const [operation, ignoreTerm, earlyExit] of [["ls-remote", false, false], ["ls-remote", true, false], ["push", true, false], ["ls-remote", true, true]] as const) {
    const label = `${operation}-${ignoreTerm ? "ignore-term" : "normal-term"}${earlyExit ? "-early-exit" : ""}`, dir = join(temp, label), pidFile = join(dir, "pids"), childFile = join(dir, "child"), cwdFile = join(dir, "cwd"), grandFile = join(dir, "grandchild"); mkdirSync(dir);
    const wrapper = join(bin, "git");
    // Both descendant shells and their sleep children retain stdout/stderr.
    // The ignoring case verifies SIGKILL escalation, not just TERM cooperation.
    writeFileSync(wrapper, `#!/bin/sh\ncase " $* " in *" ${operation} "*)\n${ignoreTerm ? "trap '' TERM" : ":"}\n/bin/sh -c 'trap "" TERM; echo $$ > "${childFile}"; echo fake-process-secret >&2; /bin/sleep 4 & echo $! > "${grandFile}"; wait' &\nchild=$!\nprintf '%s %s %s\\n' "$$" "$child" "$(/bin/ps -o pgid= -p $$ | /usr/bin/tr -d ' ')" > "${pidFile}"\npwd > "${cwdFile}"\n${earlyExit ? `for n in 1 2 3 4 5; do [ -s "${grandFile}" ] && break; /bin/sleep 0.01; done; echo fake-process-secret; exit 0` : "wait"}\n;; esac\nexec "${realGit}" "$@"\n`); chmodSync(wrapper, 0o700);
    process.env.PATH = bin + ":" + originalPath;
    let message = "", elapsed = 0, pids: number[] = [];
    const initialCalls = sim.calls.length;
    const start = performance.now();
    try { await new GitHubPrAdapter(grant, () => "fake-test-token-do-not-leak", 100).open({ repo, base: "main", branch: `crew/${label}`, head, title: "Fixture", body: "Fixture body" }, dir); }
    catch (e: any) { message = e.message; }
    finally { elapsed = performance.now() - start; process.env.PATH = originalPath; }
    if (existsSync(pidFile)) pids = readFileSync(pidFile, "utf8").trim().split(/\s+/).map(Number);
    ok(pids.length === 3 && pids[0] === pids[2], `${label}: actual Git wrapper PGID equals its owned leader PID`);
    // Query these fixture-owned PIDs only; no global process scan or PID kill.
    ok(pids.length === 3 && !info(pids[0]).running && !info(pids[1]).running && existsSync(grandFile) && !info(Number(readFileSync(grandFile, "utf8").trim())).running, `${label}: leader, pipe-holding descendant and grandchild are gone before rejection`);
    ok(elapsed < 1_200 && message.length > 0, `${label}: bounded failure (${Math.round(elapsed)} ms)`);
    ok(!/fake-process-secret|fake-test-token/.test(message), `${label}: failure is redacted`);
    ok(!existsSync(join(dir, "pr.json")) && !sim.head(`crew/${label}`) && !sim.calls.slice(initialCalls).some(c => c.method === "POST"), `${label}: no false record, pushed branch or PR creation`);
    const client = existsSync(cwdFile) ? readFileSync(cwdFile, "utf8").trim() : "";
    ok(!!client && !existsSync(client), `${label}: temporary bare client removed only after process cleanup`);
    // On the fail-first base, descendants intentionally survive. Clean only the
    // fixture PID and its owned child; it naturally exits after at most 4 s.
    if (pids.length === 3 && (info(pids[0]).running || info(pids[1]).running)) await wait(4_100);
  }
} finally { process.env.PATH = originalPath; sim.stop(); rmSync(temp, { recursive: true, force: true }); }
// Darwin can return EPERM for a zombie-only process group until its reaper
// finishes. Inject that kernel race at the signal boundary of a real child;
// a lasting permission failure must still reject rather than report success.
{
  const { ownedGit } = await import('../src/adapters/github');
  const realKill = process.kill;
  for (const persistent of [false, true]) {
    let denied = 0, message = '', output = '', retained = false;
    const start = performance.now();
    process.kill = ((pid: number, signal?: any) => {
      if (pid < 0 && ((signal === 'SIGKILL' && (persistent || denied === 0)) || (persistent && signal === 0))) {
        if (signal === 'SIGKILL') denied++;
        throw Object.assign(new Error('fixture kernel EPERM'), { code: 'EPERM' });
      }
      return realKill(pid, signal);
    }) as typeof process.kill;
    try { output = await ownedGit(['/bin/echo', 'owned-fixture'], tmpdir(), { PATH: '/usr/bin:/bin' }, 1000); }
    catch (e: any) { message = e.message; retained = e.retainClient === true; }
    finally { process.kill = realKill; }
    ok(persistent ? denied > 1 && retained && performance.now() - start < 1200 && /cleanup failed/.test(message) : denied === 1 && !message && output === 'owned-fixture', persistent
      ? 'persistent group permission denial still fails closed after bounded retries'
      : 'transient zombie-group permission denial waits for reaping before success');
  }
}
console.log(`final: ${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
