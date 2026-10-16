// A fresh Firstmate primary on Claude: the actual server, a stub Claude CLI (tests/stub-host-claude.mjs),
// the official-login fixture for `claude auth status`, a keychain stand-in and the Codex account fixture.
// Offline: no model is called, no real credential is read.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { freePort, waitUp } from "./boot.mjs";
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CREW_CLAUDE_BILLING", "CREW_MAIN_PROJECT", "CREW_FM_STATE"]) delete process.env[k];
let pass = 0, fail = 0;
const ok = (v: any, n: string) => { console.log(`${v ? "ok" : "FAIL"} ${n}`); v ? pass++ : fail++; };
const until = async (f: () => Promise<boolean> | boolean, n = 200) => { for (let i = 0; i < n; i++) { if (await f()) return true; await Bun.sleep(30); } return false; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const root = mkdtempSync(join(tmpdir(), "crew-claude-primary-")), home = join(root, "home"), data = join(root, "data"), kc = join(root, "kc");
for (const d of [join(home, ".codex"), kc]) mkdirSync(d, { recursive: true });
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
const start = () => {
  const env: any = { ...process.env, USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user", HOME: home, CODEX_HOME: join(home, ".codex"),
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
  ok(r.status === 409 && r.body.code === "claudeNotSignedIn" && /Sign in to Claude/.test(r.body.reason), "not signed in: typed claudeNotSignedIn refusal");
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
  ok(!a.includes("--dangerously-skip-permissions") && !a.includes("bypassPermissions") && a[a.indexOf("--permission-mode") + 1] === "default" && a[a.indexOf("--permission-prompt-tool") + 1] === "mcp__studio_permission__approve" && a.includes("--strict-mcp-config"), "permission bridge wired, default mode, no bypass, only Studio's MCP servers");
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
  r = await api("/api/main/start", { host: "codex", confirm: true });
  ok(r.status === 200 && (await view()).host === "codex" && codexStarts() === 1 && codexCalls().some((c) => c.method === "thread/start" && c.nativeTools?.includes("studio_propose_work")), "the Codex primary still starts with its native tools");
  await idle();
  ok((await api("/api/main/start", { host: "claude", confirm: true })).status === 409, "Claude cannot start while the Codex primary holds the lock");
  await api("/api/main/detach", {});

  // --- restart behaves like the Codex primary ---
  r = await api("/api/main/start", { host: "claude", confirm: true });
  ok(r.status === 200 && UUID.test(r.body.id) && r.body.id !== first, "a second fresh Claude primary gets another new UUID");
  await idle();
  const run2 = claudeRuns().at(-1), pid2 = run2.pid, priv2 = dirname(run2.argv[run2.argv.indexOf("--mcp-config") + 1]);
  ok(existsSync(priv2), "the running primary has its private folder");
  await stop();
  ok(!existsSync(priv2), "Studio's shutdown stops the primary and removes its private folder");
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
  ok(out.some((l: any) => l.refusal === "claudeQuotaExhausted" && /quota is exhausted/.test(l.text)) && out.some((l: any) => l.status === "failed" && /Turn failed/.test(l.text)), "a quota refusal mid-run fails the turn with a typed reason");
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
