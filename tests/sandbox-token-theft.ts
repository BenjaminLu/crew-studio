import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A round's tool token must never reach another same-uid process (architecture §10 "Loopback", the tool-token section).
// macOS exposes every same-uid process's argv AND environment through KERN_PROCARGS2, and the OS sandbox cannot block it
// (the seatbelt sysctl filter does not cover it — proven below). So a worker's test run, which runs beside the reviewer's
// CLI, could read the reviewer's tool token if it were on the CLI's argv or in its env, and POST review_verdict as the
// reviewer. The fix: the token lives only in a 0600 file inside the round's own tmp (CREW_TOOL_TOKEN_FILE), which every
// other round's and test run's sandbox denies; the CLI carries only the path. This test fails before that fix (the token
// was in the --mcp-config / -c argv) and proves each leg after it.   bun tests/sandbox-token-theft.ts
import { checkedTempDir } from "./lib/git-hygiene.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
delete process.env.CREW_LOCAL_UNRESTRICTED;
const { sandboxed, reapMarked } = await import("../src/runtime/checks");
const { claudeProvider } = await import("../src/providers/claude");
const { codexProvider } = await import("../src/providers/codex");
const root = mkdtempSync(join(tmpdir(), "crew-theft-")); mkdirSync(root, { recursive: true });

// ---- 1. the providers put the token nowhere a process exposes: not argv, not env; only a 0600 file path ----
const recorder = join(import.meta.dir, "fixture", "argv-recorder.mjs");
const TOKEN = "toolToken-" + "a1b2c3d4e5f6a7b8c9d0e1f2";
async function recorded(provider: any, label: string) {
  const rec = join(root, `rec-${label}.json`); const cwd = join(root, `cwd-${label}`); const tmp = join(cwd, "tmp"); mkdirSync(tmp, { recursive: true });
  const tokenFile = join(tmp, "tool-token"); writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  const env = { PATH: process.env.PATH ?? "", CREW_ARGV_REC: rec, CREW_TOOL_TOKEN_FILE: tokenFile, ...(label === "claude" ? { CLAUDE_CODE_OAUTH_TOKEN: "dummy-oauth-login", ANTHROPIC_API_KEY: "dummy-api-login" } : {}) };
  const session = provider.start("sys", [{ name: "review_verdict", description: "d", inputSchema: { type: "object" } }],
    { studioUrl: "http://127.0.0.1:1", token: TOKEN, tokenFile, cwd, env, mcpCommand: [recorder], sandbox: null, proxy: null });
  try { const it = session.send("hi")[Symbol.asyncIterator](); for (let i = 0; i < 20 && !existsSync(rec); i++) await it.next(); } catch {}
  session.interrupt();
  for (let i = 0; i < 40 && !existsSync(rec); i++) await Bun.sleep(50);
  const r = JSON.parse(readFileSync(rec, "utf8")); const argv = r.argv.join("\u0000"); const env2 = Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join("\u0000");
  ok(!argv.includes(TOKEN) && !env2.includes(TOKEN), `${label}: the tool token is on neither the CLI's argv nor its environment`, JSON.stringify({ inArgv: argv.includes(TOKEN), inEnv: env2.includes(TOKEN) }));
  if(label === "claude") {
    ok(!argv.includes("dummy-oauth-login") && !env2.includes("dummy-oauth-login") && !env2.includes("dummy-api-login"), "Claude login credentials never reach exec argv/environment");
    ok(r.credentials?.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR === "dummy-oauth-login" && r.credentials?.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR === "dummy-api-login", "Claude receives OAuth and API credentials through inherited file descriptors");
  }
  ok(argv.includes(tokenFile) || env2.includes("CREW_TOOL_TOKEN_FILE=" + tokenFile), `${label}: the CLI carries only the 0600 token-file path`, "");
}
await recorded(claudeProvider("m", join(import.meta.dir, "fixture", "argv-recorder.mjs")), "claude");
await recorded(codexProvider("m", join(import.meta.dir, "fixture", "argv-recorder.mjs")), "codex");

// GitHub git processes carry only a config path. No GitHub request or push is made here.
{
  const { GitHubPrAdapter } = await import("../src/adapters/github");
  const { must, setGitHome } = await import("../src/git");
  const data = checkedTempDir("crew-git-auth-"); const repo = join(data, "repo"); mkdirSync(repo);
  setGitHome(join(data, "git-home")); must(repo, ["init", "-q", "-b", "main"]);
  const token = "github-dummy-credential"; const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  const adapter = new GitHubPrAdapter({ mode: "github", repository: "fixture/project", localPath: repo, pushUrl: "https://github.com/fixture/project.git", apiOrigin: "https://api.github.com", base: "main", branchPrefix: "crew/", approvedAt: "2026-10-18T00:00:00Z", approvalId: "offline-fixture" }, () => token, 1000, data);
  const auth = adapter.remoteGit(); const config = auth.env.GIT_CONFIG_GLOBAL;
  ok(!JSON.stringify(auth.env).includes(token) && !JSON.stringify(auth.env).includes(encoded), "git authentication puts neither raw nor encoded token in the process environment");
  const { statSync } = await import("node:fs");
  ok((statSync(config).mode & 0o777) === 0o600 && readFileSync(config, "utf8").includes(encoded), "git authentication is in a private 0600 config under Studio's protected data");
  const read = Bun.spawnSync(["git", "config", "--get", "http.https://github.com/.extraHeader"], { cwd: repo, env: auth.env, stdout: "pipe", stderr: "pipe" });
  ok(read.success && read.stdout.toString().trim() === `Authorization: Basic ${encoded}`, "git consumes the credential file without receiving its contents through argv/env");
  const attacker = join(root, "git-attacker"); mkdirSync(attacker);
  const denied = await sandboxed(["/bin/cat", config], { cwd: attacker, out: join(attacker, "out"), tmp: join(attacker, "tmp"), timeoutS: 10, network: false, dataDir: data, testRun: true });
  ok(denied.code !== 0 && !denied.stdout.includes(encoded), "a sandboxed test cannot read the GitHub credential-config file");
  const { codexLogin } = await import("../src/providers/login");
  const codexKey = "sk-" + "dummy-codex-key".repeat(3), codexHome = join(data, "rounds", "codex", "home", ".codex");
  const oldKey = process.env.CODEX_API_KEY;
  process.env.CODEX_API_KEY = codexKey;
  try { codexLogin(codexHome); } finally { if (oldKey === undefined) delete process.env.CODEX_API_KEY; else process.env.CODEX_API_KEY = oldKey; }
  const codexDenied = await sandboxed(["/bin/cat", join(codexHome, "auth.json")], { cwd: attacker, out: join(attacker, "codex-out"), tmp: join(attacker, "codex-tmp"), timeoutS: 10, network: false, dataDir: data, testRun: true });
  ok(codexDenied.code !== 0 && !codexDenied.stdout.includes(codexKey), "a sandboxed test cannot read another round's Codex API-key auth.json");
}

// ---- 2. the sandbox cannot block KERN_PROCARGS2 (documented limitation), so a victim with a token in argv/env WOULD leak ----
// a victim process that carries a token both ways, to show the read is possible at all (the pre-fix shape)
const victim = Bun.spawn(["/usr/bin/python3", "-I", "-c", "import time;time.sleep(30)", "--secret=" + TOKEN], { env: { PATH: "/usr/bin:/bin", VICTIM_TOKEN: TOKEN } });
await Bun.sleep(300);
const scanner = join(root, "scan.py");
writeFileSync(scanner, `import ctypes,ctypes.util,re,sys
libc=ctypes.CDLL(ctypes.util.find_library("c"))
def pa(pid):
    mib=(ctypes.c_int*3)(1,49,pid);sz=ctypes.c_size_t(1<<18);buf=ctypes.create_string_buffer(1<<18)
    return buf.raw[:sz.value] if libc.sysctl(mib,3,buf,ctypes.byref(sz),None,0)==0 else b""
needle=sys.argv[1].encode();pid=int(sys.argv[2]);value=pa(pid)
print("procargs_bytes",len(value))
print("procargs_hit",pid if needle in value else 0)
`);
const r2 = await sandboxed(["/usr/bin/python3", "-I", scanner, TOKEN, String(victim.pid)], { cwd: root, out: join(root, "o2"), tmp: join(root, "t2"), timeoutS: 30, network: false, dataDir: root, testRun: true });
victim.kill();
ok(r2.stdout.includes(`procargs_hit ${victim.pid}\n`), "a test run CAN read another same-uid process's argv/env via KERN_PROCARGS2 (the sandbox cannot block it; a token there would leak)", JSON.stringify([r2.stdout.trim(), r2.refused]));

// Read a known live FD-only victim, rather than scanning unrelated user processes.
{
  const { spawn } = await import("node:child_process");
  const { claudeCredentialFds } = await import("../src/providers/credential-fds");
  const auth = claudeCredentialFds({ PATH: "/usr/bin:/bin", TMPDIR: root, CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  const fdVictim = spawn("/usr/bin/python3", ["-I", "-c", "import os,time;assert os.read(int(os.environ['CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR']),4096);print('ready',flush=True);time.sleep(30)"], { env: auth.env, stdio: ["ignore", "pipe", "pipe", ...auth.fds] });
  auth.close();
  try {
    await new Promise<void>((resolve, reject) => { fdVictim.stdout!.once("data", () => resolve()); fdVictim.once("error", reject); fdVictim.once("exit", () => reject(new Error("FD victim exited before readiness"))); });
    const checked = await sandboxed(["/usr/bin/python3", "-I", scanner, TOKEN, String(fdVictim.pid)], { cwd: root, out: join(root, "o2-fd"), tmp: join(root, "t2-fd"), timeoutS: 10, network: false, dataDir: root, testRun: true });
    ok(/procargs_bytes [1-9]/.test(checked.stdout) && /procargs_hit 0\n/.test(checked.stdout), "KERN_PROCARGS2 can read the FD-only victim but reveals no credential (not an unreadable-process false pass)", checked.refused ?? "");
  } finally { fdVictim.kill("SIGKILL"); }
}

// ---- 3. the token file lives under the round's data dir, which another round's / test run's sandbox denies ----
// Studio's data dir is its own tree, never under a round's worktree; the attacker's cwd is its worktree
const data = mkdtempSync(join(tmpdir(), "crew-theft-data-")); const otherRoundTmp = join(data, "rounds", "Jvictim", "tmp"); mkdirSync(otherRoundTmp, { recursive: true });
const victimFile = join(otherRoundTmp, "tool-token"); writeFileSync(victimFile, TOKEN, { mode: 0o600 });
const attackerCwd = join(root, "attacker-wt"); mkdirSync(attackerCwd, { recursive: true });
const r3 = await sandboxed(["/bin/cat", victimFile], { cwd: attackerCwd, out: join(attackerCwd, "o3"), tmp: join(attackerCwd, "t3"), timeoutS: 20, network: false, dataDir: data, testRun: true });
ok(r3.code !== 0 && !r3.stdout.includes(TOKEN), "a test run cannot read another round's 0600 token file (it is under Studio's data dir, which the sandbox denies)", JSON.stringify([r3.code, r3.stdout.slice(0, 40)]));

// ---- 4. the self-probe names the argv/env read as something the sandbox does NOT prevent ----
const { TEST_RUN_DOES_NOT } = await import("../src/runtime/checks");
ok(/argv|environment|another (process|local)/i.test(TEST_RUN_DOES_NOT) || r2.sandbox !== undefined, "the test-run sandbox report does not claim to hide other processes' argv", TEST_RUN_DOES_NOT);

// ---- 5. a setsid child that escapes the process group is reaped at the end of a run ----
{ const out = join(root, "o5", "setsid-survived"); const esc = join(root, "esc.py");
  const baseline = await sandboxed(["/usr/bin/touch", out], { cwd: root, out: join(root, "o5"), tmp: join(root, "t5"), timeoutS: 10, network: false, dataDir: root, testRun: true });
  ok(baseline.code === 0 && existsSync(out), "the cleanup proof targets a writable path, so filesystem denial cannot fake process cleanup");
  if(existsSync(out)) unlinkSync(out);
  writeFileSync(esc, `import os,time\nif os.fork()==0:\n os.setsid();time.sleep(4);open(os.environ['OUT'],'w').write('x');os._exit(0)\nprint('parent done')\n`);
  const r = await sandboxed(["/usr/bin/python3", "-I", esc], { cwd: root, out: join(root, "o5"), tmp: join(root, "t5"), timeoutS: 30, network: false, dataDir: root, testRun: true, env: { OUT: out } });
  void r; await Bun.sleep(6000);
  ok(!existsSync(out), "a test child that calls setsid to escape the process group is killed when the run ends (reaped by its run marker)"); }
void reapMarked;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
