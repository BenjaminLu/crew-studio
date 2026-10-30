import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A round on the captain's own account (src/providers/login.ts, needs.ts, claude.ts, codex.ts, runtime/checks.ts): Studio never
// reads, copies or hands on a subscription login. The vendor's unmodified CLI signs in from the captain's own account context in
// place; the round's profile opens exactly that context to it (its settings, memory, hooks and plugins read-only), opens the
// login keychain only where the CLI keeps its sign-in, and lets it run only itself, Studio's runtime and its own helpers. The model
// in the round has Studio's tools and nothing else: a CLI that announces any other tool or MCP server stops the round.
// Offline: profiles are checked as text, the CLIs are stubs.            bun tests/own-account-rounds.ts
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { suite } from "./rt-harness";
const { ok, end } = suite("own-account-rounds");
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "CREW_CLAUDE_BILLING", "CLAUDE_CONFIG_DIR", "CODEX_API_KEY", "CODEX_HOME", "ANTHROPIC_API_KEY"]) delete process.env[k];
const root = mkdtempSync(join(tmpdir(), "crew-own-account-")), home = join(root, "home"), data = join(root, "data"); mkdirSync(join(home, ".codex"), { recursive: true }); mkdirSync(data);
process.env.HOME = home;
const { roundProfile } = await import("../src/runtime/checks");
const { claudeNeeds, codexNeeds, CLAUDE_ACCOUNT_READ_ONLY } = await import("../src/providers/needs");
const { claudeProvider } = await import("../src/providers/claude");
const { codexProvider } = await import("../src/providers/codex");

// ---------- claude: what a round gets on the captain's own account, and on API billing ----------
{ const n = claudeNeeds("claude", ["api.anthropic.com"]), dir = join(root, "round-home");
  const env = n.home(dir), login = n.login(dir), acct = n.account!(), exec = n.exec!();
  ok(login.ok && login.kind === "account" && JSON.stringify(login.env) === "{}", "subscription: the login is the captain's own account, with no value handed in", JSON.stringify(login));
  ok(env.HOME === home && !("CLAUDE_CONFIG_DIR" in env), "subscription: the CLI runs in the captain's own account context (its HOME; no CLAUDE_CONFIG_DIR unless the captain set one)", JSON.stringify(env));
  ok(JSON.stringify(acct?.dirs) === JSON.stringify([join(home, ".claude")]) && acct!.regex.length === 1 && new RegExp(acct!.regex[0]).test(join(home, ".claude.json.tmp.1.ab")) && !new RegExp(acct!.regex[0]).test(join(home, ".claudeX")) && acct!.keychain === (process.platform === "darwin"),
    "subscription: the account context is the captain's Claude folder, ~/.claude.json with its lock/temp siblings, and the login keychain on macOS only", JSON.stringify(acct));
  ok(CLAUDE_ACCOUNT_READ_ONLY.every((x) => acct!.readOnly!.includes(join(home, ".claude", x))) && new RegExp(acct!.readOnlyRegex![0]).test(join(home, ".claude", "settings.local.json")) && !new RegExp(acct!.readOnlyRegex![0]).test(join(home, ".claude", "projects", "settings.json")),
    "subscription: its settings, memory, hooks and plugins stay read-only", JSON.stringify(acct?.readOnly));
  ok(exec.includes(process.execPath) && exec.includes("/usr/bin/security") && !exec.includes("/usr/bin/curl") && !exec.includes("/usr/bin"), "subscription: the round may run only the CLI, Studio's runtime and the CLI's own helpers", JSON.stringify(exec));
  process.env.CLAUDE_CONFIG_DIR = join(root, "own-claude");
  const e2 = n.home(dir), a2 = n.account!();
  ok(e2.CLAUDE_CONFIG_DIR === join(root, "own-claude") && JSON.stringify(a2?.dirs) === JSON.stringify([join(root, "own-claude")]) && a2!.regex.length === 0, "a captain's own CLAUDE_CONFIG_DIR is kept (the CLI names its keychain item after it) and is the account folder", JSON.stringify([e2, a2]));
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.CREW_CLAUDE_BILLING = "api-key"; process.env.ANTHROPIC_API_KEY = "sk-ant-api03-own-account-test-0123456789abcdef";
  const e3 = n.home(dir), l3 = n.login(dir);
  ok(e3.HOME === dir && e3.CLAUDE_CONFIG_DIR === join(dir, ".claude-config") && l3.ok && l3.kind === "api-key" && n.account!() === null && n.exec!() === null, "API billing: a throwaway home, the key Studio keeps, and no account context opened", JSON.stringify([e3, l3.ok && l3.kind]));
  delete process.env.CREW_CLAUDE_BILLING; delete process.env.ANTHROPIC_API_KEY; }

// ---------- the round profile: the account opens last, only that, settings read-only; exec narrowed ----------
{ const n = claudeNeeds("claude", []), acct = n.account!(), cwd = join(data, "work", "w");
  const prof = roundProfile({ cwd, tmp: join(data, "rounds", "J1", "tmp"), writes: [cwd], reads: [], proxyPort: 1, toolPort: 2, dataDir: data, account: { ...acct!, keychain: true }, exec: n.exec!() });
  const at = (s: string) => prof.indexOf(s), lastDeny = prof.lastIndexOf("(deny file-read* file-write*"), allow = at(`(allow file-read* file-write* (subpath ${JSON.stringify(join(home, ".claude"))})`);
  ok(allow > lastDeny && lastDeny > 0, "the account context is opened after the secret deny list (the last matching rule wins), so it is the one exception", prof.slice(lastDeny, lastDeny + 200));
  ok(/\(subpath "[^"]*\/Library\/Keychains"\)/.test(prof.slice(allow)) && prof.slice(allow).includes('(regex #"^' + home + "/\\.claude\\.json"), "the login keychain (the account's own, from the directory service) and ~/.claude.json open with it", prof.slice(allow, allow + 400));
  const ro = at("(deny file-write* (subpath " + JSON.stringify(join(home, ".claude", "CLAUDE.md")));
  ok(ro > allow && prof.includes(`(subpath ${JSON.stringify(join(home, ".claude", "hooks"))})`) && /settings\[\^\/\]\*\\\.json\$"\)/.test(prof), "then its settings, memory, hooks and plugins are denied writes again", prof.slice(ro, ro + 160));
  ok(at("(deny process-exec)") > at("(allow process-exec)") && prof.includes(`(subpath ${JSON.stringify(realpathSync(process.execPath))})`) && !prof.slice(at("(deny process-exec)")).includes("/usr/bin/curl"), "exec is narrowed to the allowed programs, after the general allow");
  const none = roundProfile({ cwd, tmp: join(data, "t"), writes: [cwd], reads: [], proxyPort: 1, toolPort: 2, dataDir: data });
  ok(!none.includes("(deny process-exec)") && !none.includes("Library/Keychains\"))\n(allow") && !none.slice(none.lastIndexOf("(deny file-read* file-write*")).includes("(allow"), "without an account (API billing, other providers) nothing is reopened and exec is not narrowed");
  const bad = roundProfile({ cwd, tmp: join(data, "t"), writes: [cwd], reads: [], proxyPort: 1, toolPort: 2, dataDir: data, account: { dirs: [home, homedir(), data, join(data, "x"), "/"], regex: [], keychain: false } });
  ok(!bad.slice(bad.lastIndexOf("(deny file-read* file-write*")).includes("(allow"), "an account folder that is a whole home, Studio's data (or inside it) or / is never opened", bad.slice(bad.lastIndexOf("(deny file-read* file-write*"))); }

// ---------- claude.ts: no settings scope ever loads; a CLI offering any other tool or MCP server stops the round ----------
{ const bin = join(root, "claude-stub.mjs"), argvFile = join(root, "argv.json");
  writeFileSync(bin, `import{writeFileSync}from'node:fs';const a=process.argv.slice(2);writeFileSync(${JSON.stringify(argvFile)},JSON.stringify(a));const tools=process.env.STUB_TOOLS?JSON.parse(process.env.STUB_TOOLS):['mcp__studio__fs_read'],mcp=process.env.STUB_MCP?JSON.parse(process.env.STUB_MCP):[{name:'studio',status:'connected'}];
const put=o=>process.stdout.write(JSON.stringify(o)+'\\n');put({type:'system',subtype:'init',model:'claude-sonnet-5-5',tools,mcp_servers:mcp});put({type:'assistant',message:{model:'claude-sonnet-5-5',content:[{type:'text',text:'done'}]}});put({type:'result',subtype:'success',is_error:false,result:'done',usage:{}});`);
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
  ok(mcp.out.some((e) => e.type === "turnEnd" && e.status === "error" && e.code === "toolsNotLocked"), "a CLI that loads another MCP server stops the round", JSON.stringify(mcp.out)); }

// ---------- codex: the captain's own codex home in place, its config read-only; model and effort on the command line ----------
{ writeFileSync(join(home, ".codex", "auth.json"), "{}", { mode: 0o600 });
  const n = codexNeeds("codex", [], { model: "fixture-model", effort: "low" }), dir = join(root, "codex-round"); n.home(dir);
  const login = n.login(dir), acct = n.account!();
  ok(login.ok && login.kind === "account" && JSON.stringify(login.env) === JSON.stringify({ CODEX_HOME: join(home, ".codex") }), "codex: the round signs in from the captain's own codex home", JSON.stringify(login));
  ok(JSON.stringify(acct?.dirs) === JSON.stringify([join(home, ".codex")]) && acct!.readOnly!.includes(join(home, ".codex", "config.toml")) && acct!.readOnly!.includes(join(home, ".codex", "rules")) && acct!.keychain === false, "codex: that home opens to the round, its config and rules read-only", JSON.stringify(acct));
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
