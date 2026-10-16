import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A fresh Firstmate primary on Claude: the actual server, a stub Claude CLI (tests/stub-host-claude.mjs),
// the official-login fixture for `claude auth status`, a keychain stand-in and the Codex account fixture.
// Offline: no model is called, no real credential is read.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { freePort, waitUp } from "./boot.mjs";
import { captainAutoMode } from "../src/host/claude-primary";
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CREW_CLAUDE_BILLING", "CREW_MAIN_PROJECT", "CREW_FM_STATE", "CREW_CLAUDE_PERMISSION_MODE", "CREW_LOCAL_UNRESTRICTED", "CREW_LOCAL_DEPENDENCY_ROOT", "STUB_EFFECTIVE_MODE"]) delete process.env[k];
let pass = 0, fail = 0;
const ok = (v: any, n: string) => { console.log(`${v ? "ok" : "FAIL"} ${n}`); v ? pass++ : fail++; };
const until = async (f: () => Promise<boolean> | boolean, n = 200) => { for (let i = 0; i < n; i++) { if (await f()) return true; await Bun.sleep(30); } return false; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const root = mkdtempSync(join(tmpdir(), "crew-claude-primary-")), home = join(root, "home"), data = join(root, "data"), kc = join(root, "kc");
for (const d of [join(home, ".codex"), join(home, ".claude"), kc]) mkdirSync(d, { recursive: true });
// the captain's own Claude settings: Studio copies the autoMode block and nothing else
const AUTO = { environment: ["$defaults", "Source control: github.com/fixture-org"], soft_deny: ["$defaults", "Never push to main in fixture-org/app"], allow: ["$defaults"], classifyAllShell: true };
const captainSettings = join(home, ".claude", "settings.json");
const writeCaptain = (autoMode: unknown) => writeFileSync(captainSettings, JSON.stringify({ autoMode, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hook" }] }] }, permissions: { allow: ["Bash(*)"], defaultMode: "bypassPermissions" }, env: { FIXTURE_ENV: "1" }, mcpServers: { x: { command: "x" } }, apiKeyHelper: "echo key" }));
writeCaptain(AUTO);
{ // shape checks on the captain's block, read by path only
  const f = join(root, "unit-settings.json"), at = (t: string) => { writeFileSync(f, t); return captainAutoMode(f); };
  ok(captainAutoMode(join(root, "absent.json")).state === "none", "no captain settings file: built-in defaults, said so");
  ok(at("{not json").state === "malformed", "captain settings that are not JSON: malformed, built-in defaults");
  ok(at('{"model":"x"}').state === "none", "captain settings without autoMode: built-in defaults");
  ok(at('{"autoMode":{"soft_deny":"x"}}').state === "malformed" && at('{"autoMode":{"allow":[1]}}').state === "malformed" && at('{"autoMode":[]}').state === "malformed", "autoMode lists must be arrays of strings in an object");
  ok(at('{"autoMode":{"hooks":[]}}').state === "malformed" && at('{"autoMode":{"classifyAllShell":"yes"}}').state === "malformed", "an unknown autoMode key or a non-boolean classifyAllShell is malformed, never copied");
  const good = at(JSON.stringify({ autoMode: AUTO, hooks: {} }));
  ok(good.state === "applied" && JSON.stringify((good as any).block) === JSON.stringify(AUTO), "a well-formed autoMode block is taken as is");
}
writeFileSync(join(home, ".codex", "config.toml"), 'model="fixture-model"\nmodel_reasoning_effort="low"\n');
writeFileSync(join(home, ".codex", ".fixture-account.json"), '{"authenticated":true}');
const CREW = "sk-ant-" + "oat01-" + "f".repeat(64); // fixture shape only
const argvFile = join(root, "claude-argv.jsonl"), codexLog = join(root, "codex.jsonl"), kcLog = join(kc, "calls.log"), kcMode = join(kc, "mode");
const keychain = join(kc, "security");
// crew: only crew-studio-claude-token exists; own: only the captain's interactive login; none: nothing
writeFileSync(keychain, `#!/bin/sh
echo "$@" >> ${kcLog}
mode=$(cat ${kcMode} 2>/dev/null)
for a in "$@"; do
  [ "$a" = crew-studio-claude-token ] && [ "$mode" = crew ] && { echo ${CREW}; exit 0; }
  [ "$a" = crew-studio-claude-token ] && [ "$mode" = empty ] && exit 0
  [ "$a" = crew-studio-claude-token ] && [ "$mode" = bad ] && { echo not-a-setup-token; exit 0; }
  [ "$a" = "Claude Code-credentials" ] && [ "$mode" = own ] && { echo '{"claudeAiOauth":{"accessToken":"${CREW}","expiresAt":0}}'; exit 0; }
done
exit 44
`, { mode: 0o755 });
const setKeychain = (m: string) => writeFileSync(kcMode, m);
const signedIn = (yes: boolean) => yes ? writeFileSync(join(home, ".claude-login-marker"), "1") : rmSync(join(home, ".claude-login-marker"), { force: true });
const seedFile = join(root, "claude-seed.jsonl");
const claudeRuns = () => existsSync(argvFile) ? readFileSync(argvFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const codexCalls = () => existsSync(codexLog) ? readFileSync(codexLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const codexStarts = () => codexCalls().filter((r) => r.method === "thread/start").length;

const port = await freePort(), base = `http://127.0.0.1:${port}`, token = "claude-primary-fixture-session";
const start = (extra: Record<string, string> = {}) => {
  const env: any = { ...process.env, ...extra, USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user", HOME: home, CODEX_HOME: join(home, ".codex"),
    CREW_DATA: data, CREW_RUNTIME_DIR: join(root, "runtime"), CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock",
    CREW_CLAUDE_BIN: join(import.meta.dir, "fixture/claude-login.mjs"), CREW_HOST_CLAUDE_BIN: join(import.meta.dir, "stub-host-claude.mjs"), CREW_KEYCHAIN_TOOL: keychain,
    CREW_HOST_CODEX_BIN: join(import.meta.dir, "fixture/codex-account.mjs"), ACCOUNT_FIXTURE_LOG: codexLog, STUB_ARGV_FILE: argvFile, STUB_SEED_FILE: seedFile, STUB_EXPECT_CREW: CREW, CREW_WAKE_GRACE_MS: "60000" };
  const p = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.resume(); p.stderr.resume(); return p;
};
// a private folder a Studio that is gone left behind: the next Studio sweeps it at boot
const deadPid = await new Promise<number>((r) => { const c = spawn("true"); c.once("exit", () => r(c.pid!)); });
const stale = join(tmpdir(), `crew-native-${deadPid}-staletest`); mkdirSync(stale, { recursive: true }); writeFileSync(join(stale, "mcp.json"), "{}");
let app = start();
const stop = async () => { if (app.exitCode === null && app.signalCode === null) { const done = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await done; } };
const api = async (path: string, body?: any) => { const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": token }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
const view = async () => (await api("/api/main")).body;
const idle = () => until(async () => { const v = await view(); return v.state === "attached" && !v.busy && v.queue.length === 0; });
const say = async (text: string) => { const before = (await view()).log.length; await api("/api/main/send", { text }); await until(async () => { const v = await view(); return !v.busy && v.queue.length === 0 && v.log.length > before && v.log.slice(before).some((l: any) => l.kind === "firstmate" || l.status === "failed"); }); return (await view()).log.slice(before); };

try {
  await waitUp(base, app);
  ok((await view()).context === "studio", "the server runs Studio's own workspace");
  ok(await until(() => !existsSync(stale)), "boot sweeps a private folder whose Studio is gone");
  const ready = async () => { try { return (await api("/api/main/start/claude-ready")).body; } catch { return {}; } };

  // --- typed refusals, never Codex ---
  signedIn(false); setKeychain("crew");
  let r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 409 && r.body.code === "claudeNotSignedIn" && /Sign in to Claude on this card/.test(r.body.en) && /這張卡片/.test(r.body.zh), "not signed in: typed claudeNotSignedIn refusal that points at this card (no separate account card)");
  ok(codexStarts() === 0 && claudeRuns().length === 0 && (await view()).state === "detached", "not signed in: no Codex thread, no Claude process, nothing attached");
  ok((await ready()).code === "claudeNotSignedIn", "the read-only preflight says not signed in");
  signedIn(true); setKeychain("none");
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 409 && r.body.code === "claudeCrewTokenMissing" && /claude setup-token/.test(r.body.reason) && !r.body.reason.includes(CREW), "no crew token: typed claudeCrewTokenMissing refusal, no secret in it");
  const pre = await ready();
  ok(pre.code === "claudeCrewTokenMissing" && /claude setup-token/.test(pre.en) && /claude setup-token/.test(pre.zh), "the preflight gives the crew-token step, in English and Chinese");
  setKeychain("own");
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 409 && r.body.code === "claudeCrewTokenMissing", "the captain's own interactive login is not used in place of the crew token");
  ok((await ready()).code === "claudeCrewTokenMissing", "the preflight also refuses the captain's own login (typed login kind)");
  ok(codexStarts() === 0 && claudeRuns().length === 0 && (await view()).state === "detached", "crew token missing: no Codex thread, no Claude process");
  ok((await api("/api/main/start", { host: "claude" })).body.code === "confirm", "a start needs the captain's confirmation");

  // --- a fresh Claude primary ---
  setKeychain("crew");
  const kcBefore = readFileSync(kcLog, "utf8");
  const okPre = await ready();
  ok(okPre.ok === true && okPre.model === "claude-sonnet-5-5" && !existsSync(join(data, "claude-firstmate")), "the preflight passes without creating the config folder");
  ok(!readFileSync(kcLog, "utf8").slice(kcBefore.length).includes(" -w"), "the preflight never decrypts a keychain item");
  // planted symlinks in the primary's config folder: Studio's settings write never follows one
  const cfgPlant = join(data, "claude-firstmate"), victimTmp = join(root, "victim-tmp.txt"), victimSettings = join(root, "victim-settings.txt");
  mkdirSync(cfgPlant, { recursive: true, mode: 0o700 }); writeFileSync(victimTmp, "untouched"); writeFileSync(victimSettings, "untouched");
  symlinkSync(victimTmp, join(cfgPlant, `settings.json.${app.pid}.tmp`)); symlinkSync(victimSettings, join(cfgPlant, "settings.json"));
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200 && r.body.ok && UUID.test(r.body.id), "signed in with a crew token: a fresh Claude primary starts with a new UUID");
  const first = r.body.id;
  await idle();
  const run = claudeRuns().at(-1), a: string[] = run?.argv ?? [];
  ok(!!run && !!first && a[a.indexOf("--session-id") + 1] === first && !a.includes("--resume") && !a.includes("--fork-session"), "the CLI creates exactly that session (--session-id), never resumes or forks one");
  ok(run?.CLAUDE_CONFIG_DIR === join(data, "claude-firstmate") && run.oauthToken === "expected", "its own config identity: Studio's config folder and the crew token");
  ok(existsSync(join(data, "claude-firstmate", "projects")), "the transcript lives in Studio's config folder, apart from ~/.claude");
  const v1 = await view();
  ok(v1.host === "claude" && v1.sessionId === first && v1.drive?.path === "fresh" && v1.driver.holder === "studio" && v1.driver.sessionId === first && v1.driver.host === "claude", "the driver lock and view name the Claude primary and its id");
  ok(v1.log.some((l: any) => l.kind === "firstmate" && /echo: Coffee onboarding/.test(l.text)), "the native Firstmate introduction is its first message");
  ok(!a.includes("--dangerously-skip-permissions") && !a.includes("bypassPermissions") && a[a.indexOf("--permission-mode") + 1] === "auto" && a[a.indexOf("--permission-prompt-tool") + 1] === "mcp__studio_permission__approve" && !a.includes("--permission-prompts") && a.includes("--strict-mcp-config"), "auto permission mode by default; the permission bridge still answers whatever auto mode escalates; no bypass, only Studio's MCP servers");
  ok(v1.drive?.permissionMode === "auto" && okPre.permissionMode === "auto", "the view and the preflight both say the permission mode is auto");
  ok(v1.drive?.effectivePermissionMode === "auto", "the view records the mode Claude itself reported at init (effective), next to the requested one");
  const studioSettings = JSON.parse(readFileSync(join(data, "claude-firstmate", "settings.json"), "utf8"));
  ok(JSON.stringify(studioSettings) === JSON.stringify({ autoMode: AUTO }) && (statSync(join(data, "claude-firstmate", "settings.json")).mode & 0o777) === 0o600, "Studio's primary settings hold exactly the captain's autoMode block (0600): no hooks, permissions, env, mcpServers or apiKeyHelper");
  ok(v1.drive?.autoMode?.state === "applied", "the view says the captain's auto-mode rules are applied");
  ok(readFileSync(victimTmp, "utf8") === "untouched" && readFileSync(victimSettings, "utf8") === "untouched" && !lstatSync(join(cfgPlant, "settings.json")).isSymbolicLink(), "a planted symlink (temp name or settings.json itself) is never written through; settings.json is a regular file");
  ok(/已套用/.test(v1.drive?.autoMode?.summaryZh ?? "") && /soft_deny 2/.test(v1.drive?.autoMode?.summaryZh ?? ""), "the auto-mode rules summary also comes in Traditional Chinese");
  const denied = (a[a.indexOf("--disallowedTools") + 1] ?? "").split(",");
  const cfgDir = join(data, "claude-firstmate");
  ok(denied.includes(`Edit(/${cfgDir}/settings*.json)`) && denied.includes(`Edit(/${cfgDir}/.claude.json)`) && denied.includes(`Edit(/${join(import.meta.dir, "..", ".env")})`) && [".env.local", ".env.development", ".env.production"].every((f) => denied.includes(`Edit(/${join(import.meta.dir, "..", f)})`)) && denied.every((d) => d.startsWith("Edit(//")), "deny rules keep the model's edit tools off Studio's primary settings and Studio's .env, whatever the classifier says");
  ok(!(existsSync(seedFile) ? readFileSync(seedFile, "utf8") : "").includes("local unrestricted execution") && v1.drive?.executionMode === "default", "by default the primary is told nothing about unrestricted execution");
  const doc1 = ((await api("/api/doctor")).body.items ?? []).find((i: any) => i.id === "claude-permission-mode");
  ok((doc1?.detailZh ?? "").startsWith("設定的 Claude 權限模式：auto") && /已套用/.test(doc1?.detailZh ?? ""), "Doctor's Chinese detail is Chinese from its first word");
  ok(/Captain auto-mode rules: applied/.test(doc1?.detail ?? "") && /Configured Claude permission mode: auto/.test(doc1?.detail ?? ""), "Doctor labels the mode as configured and says the captain's auto-mode rules are applied");
  ok(doc1?.status === "ok" && /Claude permission mode: auto/.test(doc1.detail) && /CREW_CLAUDE_PERMISSION_MODE/.test(doc1.fix + doc1.adds + doc1.detail), "Doctor shows Claude permission mode: auto and names the operator override");
  const allowed = (a[a.indexOf("--allowedTools") + 1] ?? "").split(",");
  ok(allowed.length >= 5 && allowed.every((t) => /^mcp__studio__studio_[a-z_]+$/.test(t)) && allowed.includes("mcp__studio__studio_propose_work"), "only Studio's native tools are pre-allowed, by exact name");
  const cfgFile = a[a.indexOf("--mcp-config") + 1] ?? "", priv = dirname(cfgFile);
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8")), studio = cfg.mcpServers.studio, perm = cfg.mcpServers.studio_permission;
  const toolToken = readFileSync(studio.env.CREW_TOOL_TOKEN_FILE, "utf8").trim(), permToken = readFileSync(perm.env.CREW_PERM_TOKEN_FILE, "utf8").trim();
  const line = JSON.stringify(a);
  ok(!cfgFile.startsWith("{") && toolToken.length >= 32 && permToken.length >= 32 && !line.includes(toolToken) && !line.includes(permToken) && !line.includes(studio.env.CREW_STUDIO_SOCKET) && !/CREW_(TOOL|PERM)_TOKEN|tools\.sock/.test(line), "the spawned argv holds neither token nor the socket path: --mcp-config names a file");
  ok((statSync(priv).mode & 0o777) === 0o700 && [cfgFile, studio.env.CREW_TOOL_TOKEN_FILE, perm.env.CREW_PERM_TOKEN_FILE].every((f) => (statSync(f).mode & 0o777) === 0o600) && !perm.env.CREW_PERM_TOKEN && !studio.env.CREW_TOOL_TOKEN, "the config and token files are 0600 in a 0700 folder; no token in the config");
  ok(a[a.indexOf("--setting-sources") + 1] === "user", "only user settings load, and user scope is Studio's own config folder (no workspace .claude settings or hooks)");
  ok(studio && studio.command && studio.args.some((x: string) => x.endsWith("src/mcp.ts")) && studio.env.CREW_STUDIO_SOCKET && !studio.env.CREW_STUDIO_URL, "native tools come from Studio's MCP helper over owned stdio and a private socket");

  // --- native tools through MCP ---
  let out = await say("STUB_NATIVE studio_list_workflows {}");
  const reply = out.find((l: any) => l.kind === "firstmate")?.text ?? "";
  ok(/native tools: .*studio_list_workflows/.test(reply) && reply.includes("studio_propose_work") && reply.includes("studio_staffing_facts"), "tools/list over MCP lists Studio's native tools");
  ok(/studio_list_workflows ok: \{"workflows":\[/.test(reply), "tools/call runs a native tool and returns its result");
  const listed = (/native tools: ([^|]*) \|/.exec(reply)?.[1] ?? "").split(",").filter(Boolean);
  const seed = existsSync(seedFile) ? JSON.parse(readFileSync(seedFile, "utf8").trim().split("\n")[0]).seed as string : "";
  ok(listed.length >= 12 && listed.includes("studio_startup_workflow_contract") && listed.every((n) => seed.includes(n)), "the first message names every registered native tool (" + listed.length + ")");
  const draftArgs = JSON.stringify(JSON.parse(readFileSync(join(import.meta.dir, "fixture/first-workflow-draft.json"), "utf8")));
  out = await say(`STUB_NATIVE studio_draft_workflow ${draftArgs}`);
  const drafted = out.find((l: any) => l.kind === "firstmate")?.text ?? "";
  ok(/studio_draft_workflow ok: \{"draft":"[^"]+","revision":1,"source":"model","status":"draft-preview"/.test(drafted), "a captain message drafts a workflow graph with studio_draft_workflow from the Claude primary");
  out = await say('STUB_NATIVE studio_propose_work {"workflow":"missing","version":1,"text":"x"}');
  ok(/studio_propose_work error: .*"failure":\{"schema":1,"code":"/.test(out.find((l: any) => l.kind === "firstmate")?.text ?? "") && out.some((l: any) => l.nativeFailure?.code), "a refused native call is a typed tool error, recorded for the captain");
  ok((await api("/api/wruns")).body.runs.length === 0, "the refused proposal allocated no work");
  const sock = studio.env.CREW_STUDIO_SOCKET;
  ok((await fetch("http://localhost/api/tools", { unix: sock, headers: { "x-crew-tool-token": "wrong" } } as any)).status === 403, "the native socket refuses a wrong token");
  const outside = await (await fetch("http://localhost/api/tools/studio_list_workflows", { unix: sock, method: "POST", body: "{}", headers: { "x-crew-tool-token": toolToken } } as any)).json() as any;
  ok(outside?.failure?.code === "owner_ended", "a native call outside a running turn is refused (owner_ended)");

  // --- the permission bridge ---
  await api("/api/main/send", { text: "STUB_TOOL" });
  ok(await until(async () => (await view()).approvals.some((p: any) => p.tool === "Bash")), "a Bash call waits for the captain on the permission bridge");
  let pend = (await view()).approvals.find((p: any) => p.tool === "Bash");
  await api("/api/main/approve", { id: pend.id, allow: false });
  await idle();
  ok((await view()).log.some((l: any) => l.kind === "firstmate" && /Not allowed: denied by the captain/.test(l.text)), "the captain's deny reaches the CLI");
  await api("/api/main/send", { text: "STUB_NATIVE studio_answer_card {}" });
  ok(await until(async () => (await view()).approvals.some((p: any) => p.tool === "mcp__studio__studio_answer_card")), "a tool outside the native list is not pre-allowed: it asks the bridge");
  pend = (await view()).approvals.find((p: any) => p.tool === "mcp__studio__studio_answer_card");
  await api("/api/main/approve", { id: pend.id, allow: false });
  await idle();

  // --- Stop ---
  const pid = claudeRuns().at(-1).pid;
  ok(alive(pid), "Studio owns a running Claude process");
  const stopped = await api("/api/main/detach", {}), sv = await view();
  ok(stopped.status === 200 && stopped.body.stopped === true && stopped.body.resume === null, "Stop answers stopped, with no terminal resume");
  ok(await until(() => !alive(pid)), "Stop kills the owned Claude process");
  ok(sv.state === "detached" && sv.driver.holder === "none" && !sv.driver.resume && sv.driver.host === "claude" && /Firstmate stopped/.test(sv.log.at(-1)?.text ?? ""), "Stop releases the lock like the Codex primary");
  ok(existsSync(join(data, "claude-firstmate")) && !readFileSync(kcLog, "utf8").includes("delete"), "Stop keeps credentials and the config folder");
  ok(!existsSync(sock) && !existsSync(priv), "Stop closes the native tool socket and removes the private folder");

  // --- the Codex primary is unchanged ---
  const runsBefore = claudeRuns().filter((x) => x.argv).length;
  r = await api("/api/main/start", { host: "codex", confirm: true });
  ok(r.status === 200 && (await view()).host === "codex" && codexStarts() === 1 && codexCalls().some((c) => c.method === "thread/start" && c.nativeTools?.includes("studio_propose_work")), "the Codex primary still starts with its native tools");
  await idle();
  ok((await api("/api/main/start", { host: "claude", confirm: true })).status === 409, "Claude cannot start while the Codex primary holds the lock");
  // --- Switch from Codex to Claude, atomic on the server ---
  const codexThread = (await view()).sessionId;
  for (const mode of ["empty", "bad"]) {
    setKeychain(mode);
    const pre = await ready();
    const sw = await api("/api/main/switch", { to: "claude", confirm: true }), after = await view();
    // presence only, and a fixed item can always be tried again: the preflight passes; the server's full read refuses
    ok(pre.ok === true && sw.status === 409 && sw.body.code === "claudeCrewTokenMissing" && sw.body.kept === "codex", `a ${mode} crew keychain item passes the presence preflight, but Switch refuses with claudeCrewTokenMissing`);
    ok(after.state === "attached" && after.host === "codex" && after.sessionId === codexThread && claudeRuns().filter((x) => x.argv).length === runsBefore, `Switch with a ${mode} crew item keeps the Codex Firstmate attached and starts no Claude process`);
  }
  setKeychain("crew");
  ok((await api("/api/main/switch", { to: "claude" })).body.code === "confirm", "Switch needs the captain's confirmation");
  const sw = await api("/api/main/switch", { to: "claude", confirm: true });
  ok(sw.status === 200 && sw.body.ok && UUID.test(sw.body.id) && (await view()).host === "claude", "with a working crew token Switch stops Codex and starts a fresh Claude Firstmate");
  await idle();
  ok((await api("/api/main/switch", { to: "claude", confirm: true })).body.code === "notRunning", "Switch needs a running Codex Firstmate");
  await api("/api/main/detach", {});

  // --- the operator override: env or .env only, default|auto, anything else refused ---
  await stop(); app = start({ CREW_CLAUDE_PERMISSION_MODE: "bypassPermissions" }); await waitUp(base, app);
  const runsBad = claudeRuns().filter((x) => x.argv).length;
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 409 && r.body.code === "claudeUnavailable" && /CREW_CLAUDE_PERMISSION_MODE/.test(r.body.en) && /default or auto/.test(r.body.en) && r.body.zh, "an invalid override refuses the start, typed, naming the variable and the allowed values");
  ok((await ready()).code === "claudeUnavailable" && claudeRuns().filter((x) => x.argv).length === runsBad && (await view()).state === "detached", "the preflight refuses it too; no Claude process starts");
  const docBad = ((await api("/api/doctor")).body.items ?? []).find((i: any) => i.id === "claude-permission-mode");
  ok(docBad?.status === "missing" && /not a Claude Firstmate permission mode/.test(docBad.detail), "Doctor flags the invalid override");
  await stop(); app = start({ CREW_CLAUDE_PERMISSION_MODE: "default" }); await waitUp(base, app);
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200 && r.body.ok, "with the override set to default the primary starts");
  await idle();
  const ad: string[] = claudeRuns().at(-1)?.argv ?? [];
  ok(ad[ad.indexOf("--permission-mode") + 1] === "default" && ad[ad.indexOf("--permission-prompt-tool") + 1] === "mcp__studio_permission__approve" && (await view()).drive?.permissionMode === "default", "the override sets --permission-mode default, the bridge stays, the view says default");
  ok(/Claude permission mode: default/.test(((await api("/api/doctor")).body.items ?? []).find((i: any) => i.id === "claude-permission-mode")?.detail ?? ""), "Doctor shows the overridden mode");
  await api("/api/main/detach", {});
  r = await api("/api/main/start", { host: "claude", confirm: true, permissionMode: "acceptEdits" });
  await idle();
  const ab: string[] = claudeRuns().at(-1)?.argv ?? [];
  ok(r.status === 200 && ab[ab.indexOf("--permission-mode") + 1] === "default", "a permissionMode in the API body is ignored; only the operator setting counts");
  await api("/api/main/detach", {});
  // --- the effective mode: Claude did not enable auto ---
  await stop(); app = start({ STUB_EFFECTIVE_MODE: "default" }); await waitUp(base, app);
  writeCaptain({ soft_deny: "not a list" });
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200 && r.body.ok, "a malformed captain autoMode block does not block the start");
  await idle();
  const vf = await view();
  ok(vf.drive?.permissionMode === "auto" && vf.drive?.effectivePermissionMode === "default", "auto requested, Claude reported default: the view keeps both");
  ok(vf.log.some((l: any) => /Claude permission mode: default \(auto was requested; Claude did not enable it\)/.test(l.text)), "the log says Claude did not enable auto");
  ok(JSON.stringify(JSON.parse(readFileSync(join(data, "claude-firstmate", "settings.json"), "utf8"))) === "{}" && vf.drive?.autoMode?.state === "malformed", "a malformed block is not copied; the stale one is removed");
  ok(vf.log.some((l: any) => /captain's auto-mode rules are malformed.*built-in defaults/i.test(l.text)), "the log says the malformed rules were skipped for Claude's built-in defaults");
  const docM = ((await api("/api/doctor")).body.items ?? []).find((i: any) => i.id === "claude-permission-mode");
  ok(/Captain auto-mode rules: malformed/.test(docM?.detail ?? "") && /built-in defaults/.test(docM?.detail ?? ""), "Doctor says the captain's rules are malformed and built-in defaults are used");
  await api("/api/main/detach", {});
  writeCaptain(AUTO);

  // --- local unrestricted mode (operator .env): the primary is told, the hardening stays ---
  await stop(); app = start({ CREW_LOCAL_UNRESTRICTED: "1", CREW_LOCAL_DEPENDENCY_ROOT: root }); await waitUp(base, app);
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200 && r.body.ok, "a fresh Claude primary starts in local unrestricted mode");
  await idle();
  const ur = claudeRuns().at(-1), au: string[] = ur?.argv ?? [];
  const seeds = readFileSync(seedFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)), useed = seeds.find((x: any) => x.pid === ur.pid)?.seed ?? "";
  ok(useed.startsWith("The operator explicitly enabled local unrestricted execution") && useed.includes(root) && /Coffee onboarding/.test(useed), "its first message starts with the local unrestricted execution notice");
  ok(au[au.indexOf("--permission-prompt-tool") + 1] === "mcp__studio_permission__approve" && au.includes("--strict-mcp-config") && au[au.indexOf("--setting-sources") + 1] === "user" && au.includes("--disallowedTools"), "the bridge, strict MCP config, user-only settings and deny rules stay");
  const ucfg = JSON.parse(readFileSync(au[au.indexOf("--mcp-config") + 1], "utf8"));
  ok((statSync(ucfg.mcpServers.studio.env.CREW_TOOL_TOKEN_FILE).mode & 0o777) === 0o600 && !JSON.stringify(au).includes(readFileSync(ucfg.mcpServers.studio.env.CREW_TOOL_TOKEN_FILE, "utf8").trim()), "token files stay 0600 and off the command line");
  ok((await view()).drive?.executionMode === "local-unrestricted", "the view says the primary runs unrestricted");
  ok(/Local unrestricted mode: on/.test(((await api("/api/doctor")).body.items ?? []).find((i: any) => i.id === "claude-permission-mode")?.detail ?? ""), "Doctor says the Claude primary runs unrestricted");
  await api("/api/main/detach", {});
  await stop(); app = start(); await waitUp(base, app);

  // --- restart behaves like the Codex primary ---
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200 && UUID.test(r.body.id) && r.body.id !== first, "a second fresh Claude primary gets another new UUID");
  await idle();
  const oldPid = app.pid;
  const run2 = claudeRuns().at(-1), pid2 = run2.pid, priv2 = dirname(run2.argv[run2.argv.indexOf("--mcp-config") + 1]);
  ok(existsSync(priv2), "the running primary has its private folder");
  await stop();
  ok(!existsSync(priv2), "Studio's shutdown stops the primary and removes its private folder");
  ok(!readdirSync(tmpdir()).some((n) => n.startsWith(`crew-native-${oldPid}-`)), "no private folder of the stopped Studio remains");
  app = start(); await waitUp(base, app);
  const rv = await view();
  ok(rv.state === "detached" && rv.driver.holder === "none" && !rv.driver.resume, "after a Studio restart the Claude primary is released with no resume, like Codex");
  ok(await until(() => !alive(pid2)), "the Studio restart leaves no Claude process behind");

  // --- quota: typed at run time and at start, never Codex ---
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200, "a fresh Claude primary after the restart");
  await idle();
  const starts = codexStarts();
  out = await say("STUB_QUOTA");
  ok(out.some((l: any) => l.refusal === "claudeQuotaExhausted" && l.status === "failed" && l.external?.code === "claudeQuotaExhausted" && /quota is exhausted/.test(l.text)) && !out.some((l: any) => /Turn failed/.test(l.text)), "a quota refusal mid-run fails the turn with one typed notice, no second generic line");
  ok((await view()).host === "claude" && codexStarts() === starts, "the quota refusal does not fall back to Codex");
  await api("/api/main/detach", {});
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 409 && r.body.code === "claudeQuotaExhausted" && /Wait for the reset/.test(r.body.reason), "after a quota refusal a new start is refused: claudeQuotaExhausted");
  ok((await view()).state === "detached" && codexStarts() === starts, "the quota refusal starts nothing else");
  const st = (await api("/api/claude/native/status")).body;
  ok(st.quota === "exhausted", "the Claude account card shows the quota as exhausted too");
} finally { await stop(); rmSync(root, { recursive: true, force: true }); }
console.log(`claude-firstmate-primary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
