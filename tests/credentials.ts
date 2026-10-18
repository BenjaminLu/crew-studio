import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Credentials (legacy class A1; architecture §10 "no credentials in rounds"): a
// round's environment is an allowlist (the login basics) plus only the keys its own
// provider declares; chats, work runs, checks and child tools (git, the renderer)
// get no credential either.     bun tests/credentials.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), "crew-cred-"));
const SECRETS = { GITHUB_TOKEN: "ghp_x", GH_TOKEN: "gho_x", CREW_GITHUB_TOKEN: "x", OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "sk-ant-x", AWS_SECRET_ACCESS_KEY: "x", MY_SERVICE_PASSWORD: "x", DEPLOY_KEY: "x" };
const leaked = (env: Record<string, string> | undefined, allow: string[] = []) => Object.keys(SECRETS).filter((k) => !allow.includes(k) && env && k in env);
// ---------- A1: credentials ----------
{
  Object.assign(process.env, SECRETS);
  const { Agents } = await import("../src/agent");
  const seen: any[] = [];
  const recorder = (id: string, envKeys?: string[]) => ({ id, model: "rec", envKeys, start: (_s: string, _t: any, ctx: any) => { seen.push({ id, env: ctx.env, tokenFile: ctx.tokenFile, token: ctx.tokenFile ? readFileSync(ctx.tokenFile, "utf8") : null }); return { interrupt() {}, async *send() { yield { type: "turnEnd", status: "ok" } as any; } }; } });
  const agents = new Agents(join(tmp, "a1"), () => "http://127.0.0.1:1");
  await agents.run({ kind: "t", title: "t", system: "s", text: "x", tools: [], provider: recorder("plain") as any });
  await agents.run({ kind: "t", title: "t", system: "s", text: "x", tools: [], provider: recorder("claude-like", ["ANTHROPIC_API_KEY"]) as any });
  ok(leaked(seen[0].env).length === 0 && seen[0].env.PATH && seen[0].env.CREW_TOOL_TOKEN_FILE && !seen[0].env.CREW_TOOL_TOKEN, "an agent round's environment carries only a file path for its tool credential", leaked(seen[0].env).join(","));
  ok(typeof seen[0].token === "string" && seen[0].token.length > 20 && !JSON.stringify(seen[0].env).includes(seen[0].token), "a non-sandboxed agent also keeps its tool token out of exec environment");
  ok(!existsSync(seen[0].tokenFile) && !existsSync(seen[1].tokenFile), "agent credential files are removed when their jobs end");
  ok(leaked(seen[1].env, ["ANTHROPIC_API_KEY"]).length === 0 && seen[1].env.ANTHROPIC_API_KEY === "sk-ant-x", "a provider gets only the key it declares for itself");
  const { runChat } = await import("../src/chat");
  await runChat({ provider: recorder("chat") as any, message: "hi", history: [], lang: "en", studioUrl: "http://127.0.0.1:1", token: "t", dataDir: join(tmp, "a1"), onEvent: () => {} });
  ok(leaked(seen.at(-1).env).length === 0, "a chat turn's environment carries no credential", leaked(seen.at(-1).env).join(","));
  const { ArtifactStore } = await import("../src/artifacts"); const { WorkRuns } = await import("../src/work");
  const st = new ArtifactStore(join(tmp, "a1w")); const src = join(tmp, "a1src"); mkdirSync(src); writeFileSync(join(src, "index.html"), "<html><body>x</body></html>");
  st.create({ id: "pg", title: "pg", type: "web", source: "html", entry: "index.html" }); st.addVersion("pg", { from: src, primary: "index.html", createdBy: { kind: "captain" } }); st.addNote("pg", 1, { kind: "pin", selector: "body", comment: "c" });
  const wr = new WorkRuns(st, join(tmp, "a1w")); wr.start({ artifact: "pg", n: 1, provider: recorder("work") as any, studioUrl: "http://127.0.0.1:1" }); await sleep(200);
  ok(seen.at(-1)?.id === "work" && leaked(seen.at(-1).env).length === 0, "a work run's environment carries no credential");
  const { claudeProvider } = await import("../src/providers/claude"); const { codexProvider } = await import("../src/providers/codex");
  ok((claudeProvider() as any).envKeys?.includes("ANTHROPIC_API_KEY") && !(claudeProvider() as any).envKeys?.includes("OPENAI_API_KEY") && (codexProvider() as any).envKeys?.includes("OPENAI_API_KEY"), "each CLI provider declares only its own key");
  const { scrubEnv } = await import("../src/secure");
  ok(leaked(scrubEnv()).length === 0 && scrubEnv().PATH, "child tools (git, the renderer) get the environment without credentials");
  const proxySecret = "dummy-proxy-credential";
  const proxyBase = { PATH: "/bin", HTTPS_PROXY: `http://round:${proxySecret}@127.0.0.1:1234`, http_proxy: `http://${proxySecret}@127.0.0.1:1234`, ALL_PROXY: `socks5://round:${proxySecret}@127.0.0.1:1234`, FTP_PROXY: `ftp://round:${proxySecret}@127.0.0.1:1234`, HTTP_PROXY: "http://127.0.0.1:1234", NO_PROXY: "localhost" };
  const childEnv = scrubEnv(proxyBase);
  ok(!JSON.stringify(childEnv).includes(proxySecret) && !("HTTPS_PROXY" in childEnv) && !("http_proxy" in childEnv) && !("ALL_PROXY" in childEnv), "child tools never inherit credential-bearing proxy URLs");
  ok(childEnv.HTTP_PROXY === proxyBase.HTTP_PROXY && childEnv.NO_PROXY === "localhost", "child tools retain noncredential proxy configuration");
  const keychainEnv = join(tmp, "keychain-env.txt"), keychainTool = join(tmp, "keychain-fixture.sh");
  writeFileSync(keychainTool, `#!/bin/sh\nenv >> "${keychainEnv}"\nexit 44\n`, { mode: 0o755 });
  const loginModule = join(import.meta.dir, "../src/providers/login.ts");
  const keychainProbe = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `const m = await import(${JSON.stringify(loginModule)}); m.claudeLogin(); m.claudeLoginStatus(); await m.claudeLoginPresenceAsync();`], { env: { PATH: process.env.PATH ?? "/bin", HOME: join(tmp, "empty-home"), CREW_KEYCHAIN_TOOL: keychainTool, GITHUB_TOKEN: "dummy-keychain-child-secret", HTTPS_PROXY: `http://round:${proxySecret}@127.0.0.1:1234` }, stdout: "pipe", stderr: "pipe" });
  const keychainOutput = existsSync(keychainEnv) ? readFileSync(keychainEnv, "utf8") : "";
  ok(keychainProbe.success && keychainOutput.includes("PATH=") && !keychainOutput.includes("dummy-keychain-child-secret") && !keychainOutput.includes(proxySecret), "sync and async keychain helpers receive an explicit credential-free environment");
  const { codexLogin } = await import("../src/providers/login");
  const codexKey = "sk-" + "dummy-credential".repeat(3), codexHome = join(tmp, "codex-key-home");
  process.env.CODEX_API_KEY = codexKey;
  const codexAuth = codexLogin(codexHome);
  delete process.env.CODEX_API_KEY;
  const codexAuthFile = join(codexHome, "auth.json");
  ok(codexAuth.ok && !JSON.stringify(codexAuth.env).includes(codexKey) && codexAuth.env.CODEX_HOME === codexHome && existsSync(codexAuthFile), "Codex API-key login hands child processes only a private auth-file directory");
  const { statSync } = await import("node:fs");
  ok(existsSync(codexAuthFile) && (statSync(codexAuthFile).mode & 0o777) === 0o600 && JSON.parse(readFileSync(codexAuthFile, "utf8")).OPENAI_API_KEY === codexKey, "Codex API-key auth.json has the existing native schema and mode 0600");
  // a check sees no credential either
  const { sandboxed } = await import("../src/runtime/checks");
  const r = await sandboxed(["/bin/sh", "-c", "env"], { cwd: tmp, out: join(tmp, "a1c", "out"), tmp: join(tmp, "a1c", "tmp"), timeoutS: 10, network: false });
  ok(!Object.keys(SECRETS).some((k) => r.stdout.includes(`${k}=`)) && !r.stdout.includes(`HOME=${homedir()}\n`), "a check's environment has no credential and a scrubbed HOME");
  // the renderer is spawned with a scrubbed environment
  const fakeNode = join(tmp, "fake-node.sh"); writeFileSync(fakeNode, `#!/bin/sh\nenv > "${join(tmp, "render-env.txt")}"\necho '{"ok":true}'\n`, { mode: 0o755 });
  process.env.CREW_NODE_BIN = fakeNode; process.env.CREW_PLAYWRIGHT_MODULE = fakeNode;
  const { runRender } = await import("../src/render");
  await runRender(join(tmp, "a1r"), "crop", { html: "x", out: join(tmp, "o.png") }).done;
  const renv = existsSync(join(tmp, "render-env.txt")) ? readFileSync(join(tmp, "render-env.txt"), "utf8") : "";
  ok(renv.length > 0 && !Object.keys(SECRETS).some((k) => renv.includes(`${k}=`)), "the renderer runs without credentials");
  delete process.env.CREW_NODE_BIN; delete process.env.CREW_PLAYWRIGHT_MODULE;
  for (const k of Object.keys(SECRETS)) delete process.env[k];
}

console.log(`\ncredentials: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
