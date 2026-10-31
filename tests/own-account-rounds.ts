import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A round on the captain's own sign-in (src/providers/login.ts, needs.ts, claude.ts, codex.ts, agent.ts, runtime/checks.ts):
// Studio never reads, copies or hands on a subscription login, and the vendor's unmodified CLI is a credentialed model client
// and nothing more. So the round opens to it only its credential (on macOS the login keychain database; for codex one link to
// the captain's auth.json in a private home), never a folder of the captain's and never the worktree, and lets it run only
// itself, Studio's runtime and the keychain command. Its model has Studio's tools and nothing else: a CLI that does not first
// list exactly those, or announces any other tool or MCP server, stops the round.
// Offline: profiles are checked as text, the CLIs are stubs.            bun tests/own-account-rounds.ts
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { suite } from "./rt-harness";
const { ok, end } = suite("own-account-rounds");
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "CREW_CLAUDE_BILLING", "CLAUDE_CONFIG_DIR", "CODEX_API_KEY", "CODEX_HOME", "ANTHROPIC_API_KEY"]) delete process.env[k];
process.env.CREW_CLAUDE_KEYCHAIN = "1"; // as on macOS, where the CLI keeps its sign-in in the login keychain (checked apart below)
const root = mkdtempSync(join(tmpdir(), "crew-own-account-")), home = join(root, "home"), data = join(root, "data"); mkdirSync(join(home, ".codex"), { recursive: true }); mkdirSync(data);
process.env.HOME = home;
const { roundProfile } = await import("../src/runtime/checks");
const { claudeNeeds, codexNeeds } = await import("../src/providers/needs");
const { claudeProvider } = await import("../src/providers/claude");
const { codexProvider } = await import("../src/providers/codex");

// ---------- claude: on the captain's own sign-in the CLI gets its credential and nothing else of the captain's ----------
{ const n = claudeNeeds("claude", ["api.anthropic.com"]), dir = join(root, "round-home");
  const env = n.home(dir), login = n.login(dir), acct = n.account!(), exec = n.exec!();
  ok(login.ok && login.kind === "account" && JSON.stringify(login.env) === "{}", "subscription: the login is the captain's own sign-in, with no value handed in", JSON.stringify(login));
  ok(env.HOME === dir && !("CLAUDE_CONFIG_DIR" in env) && !!env.USER, "subscription: a throwaway HOME, no CLAUDE_CONFIG_DIR (a set folder would rename the keychain item) and the login user the item is named for", JSON.stringify(env));
  ok(n.noWorkspace!() === true, "subscription: the CLI never reaches the worktree");
  ok(!("dirs" in acct!) && !("files" in acct!) && (acct!.writeRegex ?? []).length === 2 && (acct!.deny ?? []).length === 0, "subscription: the round opens no folder or file of the captain's, only (on macOS) the login keychain database", JSON.stringify(acct));
  { const kc = join("/Users/someone", "Library/Keychains"), re = new RegExp(`^${kc}/login\\.keychain(-db)?([.-][^/]*)?$`);
    ok(re.test(join(kc, "login.keychain-db")) && re.test(join(kc, "login.keychain-db.sb-1a2b")) && !re.test(join(kc, "metadata.keychain-db")) && !re.test(join(kc, "ABC/keychain-2.db")), "on macOS the keychain rule names only the login keychain database and what is written beside it (the pattern Studio writes)"); }
  ok(JSON.stringify(exec.slice(-3)) === JSON.stringify([process.execPath, "/bin/sh", "/usr/bin/security"]) && !exec.includes("/usr/bin/git") && !exec.includes("/bin/bash"), "subscription: the round may run only the CLI, Studio's runtime and the keychain command (through /bin/sh)", JSON.stringify(exec));
  process.env.CLAUDE_CONFIG_DIR = join(root, "own-claude");
  const n2 = claudeNeeds("claude", []), e2 = n2.home(dir), a2 = n2.account!();
  ok(e2.HOME === dir && e2.CLAUDE_CONFIG_DIR === join(root, "own-claude") && JSON.stringify(a2!.deny) === JSON.stringify([join(root, "own-claude")]), "a captain's own CLAUDE_CONFIG_DIR is named (the CLI names its keychain item after it) and kept closed", JSON.stringify([e2, a2]));
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.CREW_CLAUDE_BILLING = "api-key"; process.env.ANTHROPIC_API_KEY = "sk-ant-api03-own-account-test-0123456789abcdef";
  const n3 = claudeNeeds("claude", []), e3 = n3.home(dir), l3 = n3.login(dir);
  ok(e3.HOME === dir && e3.CLAUDE_CONFIG_DIR === join(dir, ".claude-config") && !e3.USER && l3.ok && l3.kind === "api-key" && n3.account!() === null && n3.exec!() === null && n3.noWorkspace!() === false, "API billing: a throwaway home, the key Studio keeps, and nothing of the captain's opened", JSON.stringify([e3, l3.ok && l3.kind]));
  delete process.env.CREW_CLAUDE_BILLING;
  ok(!n3.login(dir).ok && n3.account!() === null, "billing switched mid-setup: the round is refused, never an API-key home with an account login", JSON.stringify(n3.login(dir)));
  let invalidated = "";
  const receipt = { model: "claude-sonnet-5-5", effort: null, live: () => true, invalidate: (c?: string) => { invalidated = c ?? "?"; }, login: () => ({ ok: true, env: { ANTHROPIC_API_KEY: "sk-ant-api03-own-account-test-0123456789abcdef" }, source: "key", warn: null, kind: "api-key" as const }) };
  const n4 = claudeNeeds("claude", [], receipt as any), l4 = n4.login(dir);
  ok(!l4.ok && /verifies again/.test((l4 as any).error) && invalidated === "billingChanged" && n4.account!() === null, "a receipt made on API billing is refused and invalidated on the subscription, and its round never opens the keychain", JSON.stringify(l4));
  delete process.env.ANTHROPIC_API_KEY;
  // off macOS the CLI keeps its sign-in in a file of the captain's config folder: there the round keeps the captain's own
  // context (such rounds run only in local unrestricted mode), and nothing is reopened in a profile
  process.env.CREW_CLAUDE_KEYCHAIN = "0"; const n5 = claudeNeeds("claude", []), e5 = n5.home(dir);
  ok(e5.HOME === home && !("CLAUDE_CONFIG_DIR" in e5) && (n5.account!()!.writeRegex ?? []).length === 0, "without a keychain the CLI keeps the captain's own context, where its file-backed sign-in lives", JSON.stringify(e5));
  process.env.CREW_CLAUDE_KEYCHAIN = "1"; }

// ---------- the round profile: only the credential reopens after the deny list; exec narrowed; no worktree ----------
{ const n = claudeNeeds("claude", []), cwd = join(data, "rounds", "J1", "tmp");
  const kcRule = `^${join(home, "Library/Keychains")}/login\\.keychain-db$`;
  const prof = roundProfile({ cwd, tmp: cwd, writes: [join(data, "rounds", "J1", "home")], reads: [], proxyPort: 1, toolPort: 2, dataDir: data, account: { writeRegex: [kcRule], deny: [join(root, "own-claude")] }, exec: n.exec!() });
  const at = (x: string) => prof.indexOf(x), lastDeny = prof.lastIndexOf("(deny file-read* file-write* (subpath");
  ok(at(`(allow file-read* file-write* (regex #"${kcRule}"))`) > prof.indexOf("Library/Keychains") - 1 && at(`(regex #"${kcRule}")`) > at("(deny file-read* file-write*"), "the login keychain database reopens after the secret deny list (the last matching rule wins), and nothing else does", prof.slice(at("(allow file-read* file-write* (regex")));
  ok(!/\(allow file-read\* file-write\* \(subpath[^)]*\.claude/.test(prof) && !prof.includes("(literal " + JSON.stringify(join(home, ".claude.json"))), "no folder or file of the captain's Claude account opens (not ~/.claude, not ~/.claude.json)");
  ok(lastDeny > at(`(regex #"${kcRule}")`) && prof.slice(lastDeny).includes(join(root, "own-claude")), "a captain's own CLAUDE_CONFIG_DIR is denied after everything", prof.slice(lastDeny));
  ok(at("(deny process-exec)") > at("(allow process-exec)") && prof.includes(`(literal ${JSON.stringify(realpathSync(process.execPath))})`) && prof.includes('(literal "/usr/bin/security")') && !prof.slice(at("(deny process-exec)")).includes("/usr/bin/curl"), "exec is narrowed to the allowed programs (files as literals), after the general allow");
  const none = roundProfile({ cwd, tmp: cwd, writes: [], reads: [], proxyPort: 1, toolPort: 2, dataDir: data });
  ok(!none.includes("(deny process-exec)") && !none.includes("keychain"), "without an account (API billing, other providers) nothing is reopened and exec is not narrowed");
  const bad = roundProfile({ cwd, tmp: cwd, writes: [], reads: [], proxyPort: 1, toolPort: 2, dataDir: data, account: { writeFiles: [join(data, "keys.json"), join(data, "x", "y")] } });
  ok(!bad.includes("(allow file-read* file-write* (literal"), "a login file inside Studio's data is never opened", bad.slice(bad.lastIndexOf("(deny"))); }

// ---------- execOf: the CLI's real binary, its own folder (never a shared bin folder), and its #! interpreter ----------
{ const { execOf } = await import("../src/providers/needs");
  const pkg = join(root, "lib", "node_modules", "@x", "cli", "bin"); mkdirSync(pkg, { recursive: true }); const launcher = join(pkg, "cli.js");
  writeFileSync(launcher, "#!/usr/bin/env node\n"); chmodSync(launcher, 0o755);
  const e = execOf(launcher), node = Bun.which("node");
  ok(e[0] === realpathSync(launcher) && e.includes(realpathSync(pkg)) && e.includes(realpathSync(join(pkg, ".."))) && e.includes("/usr/bin/env") && (!node || e.includes(node)), "an npm launcher: its file, its package, /usr/bin/env and the node it names", JSON.stringify(e));
  const lone = join(root, "usr", "local", "bin"); mkdirSync(lone, { recursive: true }); const sh = join(lone, "tool"); writeFileSync(sh, "\x7fELF"); chmodSync(sh, 0o755);
  const e2 = execOf(sh);
  ok(JSON.stringify(e2) === JSON.stringify([realpathSync(sh)]), "a binary in a shared folder (here …/usr/local/bin): the file itself only, never its folder", JSON.stringify(e2)); }

// ---------- claude.ts: no settings scope ever loads; a CLI offering any other tool or MCP server stops the round ----------
{ const bin = join(root, "claude-stub.mjs"), argvFile = join(root, "argv.json");
  writeFileSync(bin, `import{writeFileSync}from'node:fs';const a=process.argv.slice(2);writeFileSync(${JSON.stringify(argvFile)},JSON.stringify(a));const tools=process.env.STUB_TOOLS?JSON.parse(process.env.STUB_TOOLS):['mcp__studio__fs_read'],mcp=process.env.STUB_MCP?JSON.parse(process.env.STUB_MCP):[{name:'studio',status:'connected'}];
const put=o=>process.stdout.write(JSON.stringify(o)+'\\n');if(!process.env.STUB_NO_INIT)put({type:'system',subtype:'init',model:'claude-sonnet-5-5',tools,mcp_servers:mcp});if(process.env.STUB_CALL)put({type:'assistant',message:{model:'claude-sonnet-5-5',content:[{type:'tool_use',id:'t1',name:process.env.STUB_CALL,input:{command:'id'}}]}});put({type:'assistant',message:{model:'claude-sonnet-5-5',content:[{type:'text',text:'done'}]}});put({type:'result',subtype:'success',is_error:false,result:'done',usage:{}});`);
  chmodSync(bin, 0o755); const tokenFile = join(root, "tool-token"); writeFileSync(tokenFile, "t", { mode: 0o600 });
  const run = async (env: Record<string, string>) => { const p = claudeProvider("claude-sonnet-5-5", bin); const out: any[] = [];
    for await (const e of p.start("sys", [{ name: "fs_read", description: "", inputSchema: {} }], { cwd: root, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, ...env }, studioUrl: "http://127.0.0.1:1", tokenFile, token: "t", mcpCommand: ["/usr/bin/true"], sandbox: null } as any).send("go")) out.push(e);
    return { out, argv: JSON.parse((await import("node:fs")).readFileSync(argvFile, "utf8")) as string[] }; };
  const good = await run({}), a = good.argv;
  ok(a[a.indexOf("--setting-sources") + 1] === "" && JSON.parse(a[a.indexOf("--settings") + 1]).disableAllHooks === true && a[a.indexOf("--tools") + 1] === "" && a.includes("--strict-mcp-config"), "a round loads no settings scope (no CLAUDE.md memory, hooks or plugins of the account it runs in), with hooks off and no built-in tool", JSON.stringify(a));
  ok(good.out.some((e) => e.type === "turnEnd" && e.status === "ok"), "a CLI that offers only Studio's tools runs the turn", JSON.stringify(good.out.at(-1)));
  const bash = await run({ STUB_TOOLS: JSON.stringify(["mcp__studio__fs_read", "Bash"]) });
  ok(bash.out.some((e) => e.type === "turnEnd" && e.status === "error" && e.code === "toolsNotLocked") && !bash.out.some((e) => e.type === "turnEnd" && e.status === "ok"), "a CLI that offers the model a built-in tool (Bash) stops the round", JSON.stringify(bash.out));
  const mcp = await run({ STUB_MCP: JSON.stringify([{ name: "studio" }, { name: "captain-github" }]) });
  ok(mcp.out.some((e) => e.type === "turnEnd" && e.status === "error" && e.code === "toolsNotLocked"), "a CLI that loads another MCP server stops the round", JSON.stringify(mcp.out));
  const silent = await run({ STUB_NO_INIT: "1" });
  ok(silent.out.some((e) => e.type === "turnEnd" && e.status === "error" && e.code === "toolsNotLocked") && !silent.out.some((e) => e.type === "delta"), "fail closed: a CLI that never lists its tools (no init) is refused before any output is taken", JSON.stringify(silent.out));
  const call = await run({ STUB_CALL: "Bash" });
  ok(call.out.some((e) => e.type === "turnEnd" && e.code === "toolsNotLocked") && !call.out.some((e) => e.type === "toolStart"), "a tool call to anything but a Studio tool stops the round, even after a clean init", JSON.stringify(call.out)); }

// ---------- codex: a private home linking the captain's own login; nothing else of the captain's codex home ----------
{ writeFileSync(join(home, ".codex", "auth.json"), "{}", { mode: 0o600 }); writeFileSync(join(home, ".codex", "config.toml"), 'notify=["/bin/touch","x"]\n');
  const n = codexNeeds("codex", [], { model: "fixture-model", effort: "low" }), dir = join(root, "codex-round"); n.home(dir);
  const login = n.login(dir), acct = n.account!(), priv = join(dir, ".codex");
  ok(login.ok && login.kind === "account" && JSON.stringify(login.env) === JSON.stringify({ CODEX_HOME: priv }) && lstatSync(join(priv, "auth.json")).isSymbolicLink() && realpathSync(join(priv, "auth.json")) === realpathSync(join(home, ".codex", "auth.json")) && readdirSync(priv).join() === "auth.json",
    "codex: the round's private CODEX_HOME holds only a link to the captain's own auth.json (no config.toml, no hooks, no rules)", JSON.stringify(login));
  ok(JSON.stringify(acct) === JSON.stringify({ writeFiles: [realpathSync(join(home, ".codex", "auth.json"))] }) && n.noWorkspace!() === true && !("exec" in n && n.exec), "codex: the round reaches that one login file (read and write, for the CLI's own refresh), and no folder of the captain's", JSON.stringify(acct));
  const bin = join(root, "codex-stub.mjs"), argvFile = join(root, "codex-argv.json");
  writeFileSync(bin, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(argvFile)},JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:'turn.completed'}));`); chmodSync(bin, 0o755);
  const p = codexProvider("fixture-model", bin, { model: "fixture-model", effort: "low" }); const tokenFile = join(root, "codex-token"); writeFileSync(tokenFile, "t", { mode: 0o600 });
  for await (const _ of p.start("sys", [], { cwd: root, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...login.ok ? login.env : {} }, studioUrl: "http://127.0.0.1:1", tokenFile, token: "t", mcpCommand: ["/usr/bin/true"], sandbox: null } as any).send("go")) {}
  const a: string[] = JSON.parse((await import("node:fs")).readFileSync(argvFile, "utf8"));
  ok(!a.includes("-p") && a[a.indexOf("-m") + 1] === "fixture-model" && a.includes('model_reasoning_effort="low"') && a.includes("--ignore-user-config"), "codex: the approved model and effort go on the command line, with no profile and none of the captain's config", JSON.stringify(a)); }

// ---------- the Claude primary on the captain's own account: no token, none of its settings, its settings and hooks off-limits ----------
{ const { claudePrimaryReadiness } = await import("../src/host/claude-primary"); const { claudeDenyEditsFor } = await import("../src/host/main");
  const cfg = join(data, "claude-firstmate"), pair = { model: "claude-sonnet-5-5", effort: null };
  const r: any = await claudePrimaryReadiness({ pair, configDir: cfg, signInPending: false, status: async () => ({ available: true, loginState: "logged-in", quota: "unknown" }) as any, login: () => ({ ok: true, env: {}, source: "own", warn: null, kind: "account" }), captainSettings: join(root, "none.json") });
  ok(r.ok && r.env.HOME === home && !("CLAUDE_CONFIG_DIR" in r.env) && r.env.CREW_PRIMARY_SETTINGS_FILE === join(cfg, "settings.json") && !Object.keys(r.env).some((k) => /TOKEN|API_KEY/.test(k)), "the primary runs in the captain's own account context with Studio's settings file only, and no credential", JSON.stringify(r.env));
  const deny = claudeDenyEditsFor(r.env);
  ok(deny.includes(join(home, ".claude", "settings*.json")) && deny.includes(join(home, ".claude", "hooks/**")) && deny.includes(join(home, ".claude.json")) && deny.includes(join(cfg, "settings*.json")), "its edit tools are denied the captain's own Claude settings, hooks and ~/.claude.json, and Studio's settings file", JSON.stringify(deny));
  const k: any = await claudePrimaryReadiness({ pair, configDir: cfg, signInPending: false, status: async () => ({ available: true, loginState: "logged-in", quota: "unknown" }) as any, login: () => ({ ok: true, env: { ANTHROPIC_API_KEY: "sk-ant-api03-x" }, source: "key", warn: null, kind: "api-key" }), captainSettings: join(root, "none.json") });
  ok(k.ok && k.env.CLAUDE_CONFIG_DIR === cfg && !k.env.CREW_PRIMARY_SETTINGS_FILE, "on an API key the primary keeps Studio's own config folder", JSON.stringify(k.env));
  const t: any = await claudePrimaryReadiness({ pair, configDir: cfg, signInPending: false, status: async () => ({ available: true, loginState: "logged-in", quota: "unknown" }) as any, login: () => ({ ok: true, env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" }, source: "a copied token", warn: null }), captainSettings: join(root, "none.json") });
  ok(!t.ok, "a login with no supported kind (a copied OAuth token) never starts a primary", JSON.stringify(t)); }
end();
