import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { sessionCookie } from "../src/csrf.ts";
// The round sandbox (units round-sandbox, fix-round-sandbox-r1; architecture §10):
// every agent round runs under the OS sandbox with a round profile. It writes only
// its worktree, its tmp and a throwaway home (never the provider's real config, never
// a worktree's .git link); it reads and stats nothing of Studio's data and nothing of
// a protected root; it reaches Studio only through a tools-only listener (never the
// main port, its page, its session or its API) and the network only through the
// egress proxy, with a credential of its own and the host list of that round; its env
// carries no token but its provider's own key; a round killed at its time limit leaves
// no live process; a provider that cannot be sandboxed is refused (only the stub is
// sandbox-free); without an OS sandbox a round is refused; the engine sandboxes every
// agent node, and only a signed captain grant turns that off.   bun tests/round-sandbox.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
// a home of the test's own: the "real" provider config a round must never write
const realHome = mkdtempSync(join(tmpdir(), "crew-home-")); process.env.HOME = realHome;
// nothing from the runner's own environment decides a login here: every input the login reads is cleared (or set by this test)
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "CREW_CLAUDE_BILLING", "CODEX_API_KEY", "CODEX_HOME", "CREW_KEYCHAIN_TOOL"]) delete process.env[k];
mkdirSync(join(realHome, ".claude"), { recursive: true });
// the user's other secret folders, each with a file a round must not read
writeFileSync(join(realHome, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "someone@example.com" }, userID: "u1", projects: { "/x": {} } }));
const { Agents } = await import("../src/agent");
const { Egress } = await import("../src/egress");
const { claudeProvider } = await import("../src/providers/claude");
const { stubProvider } = await import("../src/providers/stub");
const data = mkdtempSync(join(tmpdir(), "crew-round-"));
writeFileSync(join(data, "ledger.key"), "SECRET-LEDGER-KEY");
// one probe per entry of the profile's own deny list (SECRET_DIRS), so the probes cannot drift from it; the login keychain is probed apart (a folder of databases)
const { SECRET_DIRS } = await import("../src/runtime/checks");
const FILEISH = /(\.netrc|\.json|\.npmrc|\.git-credentials|\.key|github-token)$/;
const SECRET_FILES = [...SECRET_DIRS(data).filter((p) => !p.endsWith("Library/Keychains")).map((p) => (FILEISH.test(p) ? p : join(p, "probe-secret"))), join(realHome, ".config", "gh", "hosts.yml")]; // gh's own login, named
for (const f of SECRET_FILES) if (!existsSync(f)) { mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, "SECRET"); }
const wt = join(data, "work", "sandbox", "R-1"); mkdirSync(wt, { recursive: true }); writeFileSync(join(wt, ".git"), "gitdir: /somewhere/.git/worktrees/R-1\n");
const outside = join(data, "outside.txt");
const egress = new Egress(join(data, "egress.log")); await egress.start();
// Studio's main port (a stand-in that hands out a cookie and data, as the real page and API would) and its tools-only listener
const main = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("studio page", { headers: { "set-cookie": "crew_session=SECRET; HttpOnly" } }) });
const agents = new Agents(data, () => `http://127.0.0.1:${main.port}`);
const tools = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => { const u = new URL(req.url); const t = req.headers.get("x-crew-tool-token") ?? "";
  if (!u.pathname.startsWith("/api/tools")) return new Response("no", { status: 404 }); if (!agents.hasToken(t)) return new Response("no", { status: 401 });
  return Response.json(u.pathname === "/api/tools" ? agents.toolList(t) : await agents.callTool(t, u.pathname.slice(11), {})); } });
agents.egress = egress; agents.toolUrl = () => `http://127.0.0.1:${tools.port}`;
const protectedRoot = mkdtempSync(join(tmpdir(), "crew-protected-")); agents.protect = () => [protectedRoot];
process.env.GITHUB_TOKEN = "ghp_x"; process.env.ANTHROPIC_API_KEY = "sk-ant-own"; process.env.OPENAI_API_KEY = "sk-other";
// the keychain, as Studio (outside the sandbox) reads it: a stand-in security(1) holding the crew's token
const CREW_TOKEN = "sk-ant-oat01-crew-oauth-fixture-0123456789-abcdefghijklmnopqrstuvwxyz";
let kcCalls = ""; { const kcd = mkdtempSync(join(tmpdir(), "crew-kc-")); const tool = join(kcd, "security");
  writeFileSync(tool, `#!/bin/sh\necho "$@" >> ${join(kcd, "calls.log")}\nfor a in "$@"; do [ "$a" = crew-studio-claude-token ] && { echo ${CREW_TOKEN}; exit 0; }; done\nexit 44\n`, { mode: 0o755 }); process.env.CREW_KEYCHAIN_TOOL = tool; kcCalls = join(kcd, "calls.log"); }
const provider = claudeProvider("test-model", join(import.meta.dir, "fixture", "round-cli.cjs"));
mkdirSync(join(data, "cards"), { recursive: true }); writeFileSync(join(data, "cards", "SC-1.json"), "CARD");
const probe = { outside, inside: join(wt, "inside.txt"), key: join(data, "ledger.key"), dataFile: join(data, "cards", "SC-1.json"), badHost: "evil.example",
  realConfig: join(realHome, ".claude", "settings.json"), gitLink: join(wt, ".git"), mainUrl: `http://127.0.0.1:${main.port}`, secrets: SECRET_FILES };
const job = await agents.run({ kind: "t", title: "probe", system: "s", text: `PROBE ${JSON.stringify(probe)}`, tools: [], provider, timeoutMs: 30000, sandbox: { writes: [wt], cwd: wt } });
let r: any = {}; try { r = JSON.parse(job.said); } catch {}
ok(job.status === "done" && r.wroteInside === true && existsSync(join(wt, "inside.txt")), "a round writes in its worktree", `${job.status} ${job.error} ${job.said.slice(0, 200)}`);
ok(r.wroteOutside === false && !existsSync(outside), "a round cannot write outside its worktree");
ok(r.wroteRealConfig === false && !existsSync(join(realHome, ".claude", "settings.json")) && r.wroteHome === true && r.home !== realHome && /\/rounds\/J\w+\/home$/.test(r.home ?? ""),
  "a round cannot write the provider's real config (~/.claude/settings.json); it writes a throwaway home of its own", JSON.stringify([r.wroteRealConfig, r.wroteHome, r.home]));
ok(r.wroteGitLink === false && readFileSync(join(wt, ".git"), "utf8").startsWith("gitdir: /somewhere"), "a round cannot rewrite its worktree's .git link (Studio's git reads it outside the sandbox)");
ok(r.key === null, "a round cannot read Studio's ledger key");
ok(SECRET_FILES.length >= 17 && Array.isArray(r.secretReads) && r.secretReads.length === 0, `a round reads none of the ${SECRET_FILES.length} entries of the deny list, each probed from inside the round (Studio's key files, ~/.ssh … ~/.claude.json)`, JSON.stringify(r.secretReads));
ok(r.dataFile === null && r.statData === false, "a round can neither read nor stat anything else in Studio's data (only its worktree)");
ok(r.mainPage?.status !== 200 && !r.mainPage?.cookie && r.mainApi?.status !== 200, "a round cannot reach Studio's main port: not its page, not its session cookie, not any /api route", JSON.stringify([r.mainPage, r.mainApi]));
ok(r.tools === 200 && r.toolsOther === 404, "a round reaches Studio only through the tools-only listener, which answers its tools and nothing else", `${r.tools} ${r.toolsOther}`);
ok(r.direct === false, "a round cannot open a connection of its own (only the proxy is reachable)");
const log = existsSync(join(data, "egress.log")) ? readFileSync(join(data, "egress.log"), "utf8") : "";
ok(r.proxyRefused === 403 && /evil\.example/.test(log), "the egress proxy refuses a host off the round's list, and logs it", `${r.proxyRefused}`);
ok(r.proxyNoCred !== undefined && r.proxyNoCred !== 407, "the admitted round's scoped proxy needs no credential in its environment", `${r.proxyNoCred}`);
{ const { connect } = await import("node:net");
  const reply = await new Promise<string>((resolve, reject) => { let out = ""; const socket = connect(egress.port, "127.0.0.1", () => socket.write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test\r\n\r\n")); socket.on("data", b => out += b); socket.on("end", () => resolve(out)); socket.on("error", reject); });
  ok(/^HTTP\/1.1 407/.test(reply), "the central trusted proxy still rejects a request without its upstream credential");
}
{ const { isCredentialName } = await import("../src/secure");
  const creds = (r.envKeys ?? []).filter((k: string) => isCredentialName(k) || /KEY$|TOKEN|SECRET/.test(k)).sort();
  ok(JSON.stringify(creds) === JSON.stringify(["CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CREW_TOOL_TOKEN_FILE"]) && r.oauth === CREW_TOKEN && /^http:\/\/127\.0\.0\.1:\d+$/.test(r.proxyEnv ?? ""),
    "the round's env holds only its vendor credential descriptor and a PATH to its tool token (never either token itself, which KERN_PROCARGS2 would expose): no GitHub token, no API key from Studio's environment; its traffic goes to the proxy", JSON.stringify([creds, r.oauth === CREW_TOKEN]));
  ok(!(r.envKeys ?? []).includes("CREW_TOOL_TOKEN") && r.toolTokenEnv == null && r.toolTokenFileIsPath === true, "the tool token is not anywhere in the round's environment; CREW_TOOL_TOKEN_FILE names a 0600 file, and the token lives only there", JSON.stringify([r.toolTokenEnv, r.toolTokenFileIsPath])); }
ok(r.claudeTmp === r.tmpdir && /\/rounds\/J\w+\/tmp$/.test(r.tmpdir ?? ""), "the CLI's own temporary folder is the round's tmp, never a shared /tmp folder", `${r.claudeTmp} ${r.tmpdir}`);
ok(!existsSync(join(data, "rounds", job.id, "home")) && egress.status().rounds === 0, "after the round its throwaway home and its proxy credential are gone");
// Scoped listener creation yields to the event loop: cancellation must be checked again.
{ const abort = new AbortController(); let launches = 0;
  agents.egress = { port: egress.port, open(t, h) { egress.open(t, h); abort.abort(); }, close(t) { egress.close(t); } };
  const p = {...provider, start() { launches++; throw new Error("cancelled owner must not launch"); }};
  const stopped = await agents.run({kind:"t",title:"cancel during relay setup",system:"s",text:"x",tools:[],provider:p,signal:abort.signal,sandbox:{writes:[wt],cwd:wt}});
  agents.egress = egress;
  ok(launches === 0 && stopped.status === "failed" && egress.status().rounds === 0, "cancellation during scoped listener setup refuses before provider launch and revokes the listener");
}
// the host list belongs to one round
{ const g = await agents.run({ kind: "t", title: "granted", system: "s", text: `PROBE ${JSON.stringify({ granted: "registry.example.test" })}`, tools: [], provider, timeoutMs: 30000, sandbox: { writes: [wt], allow: ["registry.example.test"] } });
  let a: any = {}; try { a = JSON.parse(g.said); } catch {}
  const n = await agents.run({ kind: "t", title: "next", system: "s", text: `PROBE ${JSON.stringify({ granted: "registry.example.test" })}`, tools: [], provider, timeoutMs: 30000, sandbox: { writes: [wt] } });
  let b: any = {}; try { b = JSON.parse(n.said); } catch {}
  ok(a.proxyGranted !== undefined && a.proxyGranted !== 403 && a.proxyGranted !== 407 && b.proxyGranted === 403, "a host one round's policy grants is let through for that round, and refused to the next round", JSON.stringify([a.proxyGranted, b.proxyGranted, g.error])); }
// v1 option A: the login is read by Studio outside the sandbox; the round gets its vendor token and nothing else
{ const kc = join(realHome, "Library", "Keychains", "probe.keychain-db"); mkdirSync(join(kc, ".."), { recursive: true }); writeFileSync(kc, "SECRET");
  const kr = await agents.run({ kind: "t", title: "keychain", system: "s", text: `PROBE ${JSON.stringify({ secrets: [kc], badHost: "api.github.com" })}`, tools: [], provider, timeoutMs: 30000, sandbox: { writes: [wt] } });
  let k2: any = {}; try { k2 = JSON.parse(kr.said); } catch {}
  ok(kr.status === "done" && Array.isArray(k2.secretReads) && k2.secretReads.length === 0, "a round cannot open the login keychain (a probe from inside)", JSON.stringify([kr.error, k2.secretReads]));
  ok(k2.proxyRefused === 403, "no GitHub host is reachable from a round (api.github.com is refused by its proxy)", String(k2.proxyRefused)); }
{ const missing = mkdtempSync(join(tmpdir(), "crew-nokc-")); const none = join(missing, "security"); writeFileSync(none, "#!/bin/sh\nexit 44\n", { mode: 0o755 });
  const before = process.env.CREW_KEYCHAIN_TOOL; process.env.CREW_KEYCHAIN_TOOL = none;
  const k = await agents.run({ kind: "t", title: "no login", system: "s", text: "PROBE {}", tools: [], provider, timeoutMs: 5000, sandbox: { writes: [wt] } });
  process.env.CREW_KEYCHAIN_TOOL = before;
  ok(k.status === "failed" && /has no login for a round/.test(k.error ?? ""), "with no login to hand, a claude round is refused before it starts", k.error ?? ""); }
// a provider that cannot be sandboxed is refused; only the stub is sandbox-free
{ const fake = { id: "fake", model: "m", start: () => { throw new Error("must not start"); } } as any;
  const f = await agents.run({ kind: "t", title: "fake", system: "s", text: "x", tools: [], provider: fake, timeoutMs: 5000, sandbox: { writes: [] } });
  ok(f.status === "failed" && /cannot run in the round sandbox/.test(f.error ?? ""), "a sandboxed round on a provider with no sandbox needs is refused, never run bare", f.error ?? "");
  ok(stubProvider().sandboxFree === true && !(claudeProvider() as any).sandboxFree, "only the stub is declared sandbox-free"); }
// every provider declares exactly one of: sandbox needs (CLI or in-process), sandbox-free (the stub)
{ const { PROVIDERS, makeProvider } = await import("../src/providers/index");
  const bad = PROVIDERS.filter((id) => { const p: any = makeProvider(id); return !!p.sandboxNeeds === !!p.sandboxFree; });
  ok(!bad.length && PROVIDERS.filter((id) => (makeProvider(id) as any).sandboxFree).join(",") === "stub", "every provider declares exactly one of sandbox needs or sandbox-free, and only the stub is sandbox-free", JSON.stringify(bad)); }
// a throw at any step of a sandboxed round still releases its proxy credential, its throwaway home and its tmp
{ const before = egress.status().rounds;
  const { readdirSync } = await import("node:fs");
  const homes = () => (existsSync(join(data, "rounds")) ? readdirSync(join(data, "rounds")).filter((d) => existsSync(join(data, "rounds", d, "home")) || existsSync(join(data, "rounds", d, "tmp"))) : []);
  const startThrows = { ...provider, start: () => { throw new Error("cannot start"); } } as any;
  const a = await agents.run({ kind: "t", title: "start throws", system: "s", text: "x", tools: [], provider: startThrows, timeoutMs: 5000, sandbox: { writes: [wt] } });
  const blocker = join(data, "a-file"); writeFileSync(blocker, "x");
  const b = await agents.run({ kind: "t", title: "record throws", system: "s", text: "x", tools: [], provider, timeoutMs: 5000, sandbox: { writes: [wt] }, record: { dir: join(blocker, "x"), header: {} } });
  const homeThrows = { ...provider, sandboxNeeds: () => ({ ...provider.sandboxNeeds!(), home: () => { throw new Error("cannot make the home"); } }) } as any;
  const c = await agents.run({ kind: "t", title: "home throws", system: "s", text: "x", tools: [], provider: homeThrows, timeoutMs: 5000, sandbox: { writes: [wt] } });
  ok([a, b, c].every((j) => j.status === "failed") && egress.status().rounds === before && homes().length === 0, "a throw when the provider starts, when the record is written or when the home is made still releases the proxy credential, the home and the tmp",
    JSON.stringify([a.error, b.error, c.error, egress.status().rounds, homes()])); }
// a direct HTTP provider runs in a sandboxed round: in Studio's process, its requests through the proxy with the round's credential, to its host only
{ const { setKeysDir, saveKeys } = await import("../src/keys"); const kd = mkdtempSync(join(tmpdir(), "crew-keys-")); setKeysDir(kd);
  const api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ choices: [{ message: { role: "assistant", content: "OK from the model" } }] }) });
  saveKeys({ compatBaseUrl: `http://127.0.0.1:${api.port}/v1` });
  const seen: any[] = []; egress.onEvent = (e) => seen.push(e);
  const { compatProvider } = await import("../src/providers/http");
  const { harness, until, Y } = await import("./rt-harness");
  const H = await harness([Y({ id: "http", name: "http", roles: [{ id: "w", label: "W", skill: "x" }], nodes: [{ id: "a", kind: "agent", label: "A", role: "w", mode: "test", x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["a", "e"]] })]);
  H.agents.egress = egress; H.agents.toolUrl = () => H.toolUrl; (H.engine as any).deps.provider = () => compatProvider("m");
  const run = H.engine.start({ workflow: "http", text: "x" }); await until(() => ["succeeded", "failed"].includes(H.engine.get(run.id)!.status), 20000);
  const jid = H.engine.get(run.id)!.nodes.a.data.jobs?.[0]?.id; const j = jid ? H.agents.jobs.get(jid) : null;
  ok(H.engine.get(run.id)!.status === "succeeded" && j?.said === "OK from the model" && seen.some((e) => e.allowed && e.host === "127.0.0.1" && e.port === api.port && e.round), "a direct HTTP provider works under the always-sandbox engine path: its request went through the proxy with the round's credential",
    JSON.stringify([H.engine.get(run.id)!.status, j?.error, seen.slice(-3)]));
  egress.onEvent = () => {}; H.stop(); api.stop(); }
// paths: a protected root or Studio's data outside data/work is refused
{ const p1 = await agents.run({ kind: "t", title: "p1", system: "s", text: "PROBE {}", tools: [], provider, timeoutMs: 5000, sandbox: { writes: [join(protectedRoot, "wt")] } });
  const p2 = await agents.run({ kind: "t", title: "p2", system: "s", text: "PROBE {}", tools: [], provider, timeoutMs: 5000, sandbox: { writes: [join(data, "cards")] } });
  ok(p1.status === "failed" && /refused/.test(p1.error ?? "") && p2.status === "failed" && /refused/.test(p2.error ?? ""), "a round whose folder is inside a protected root, or in Studio's data outside data/work, is refused", `${p1.error} | ${p2.error}`); }
// a round stopped at its time limit leaves nothing running
{ const t0 = Date.now(); const pidFile = join(wt, "pids.json");
  const hang = await agents.run({ kind: "t", title: "hang", system: "s", text: `PROBE ${JSON.stringify({ hang: true, pids: pidFile })}`, tools: [], provider, timeoutMs: 1500, sandbox: { writes: [wt] } });
  await new Promise((res) => setTimeout(res, 400));
  const pids = existsSync(pidFile) ? JSON.parse(readFileSync(pidFile, "utf8")) : null; const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  ok(hang.status === "failed" && /no result within/.test(hang.error ?? "") && Date.now() - t0 < 8000 && !!pids && !alive(pids.self) && !alive(pids.child), "a round killed at its time limit leaves no live process (the CLI and its child, by pid)", `${hang.status} ${hang.error} ${JSON.stringify(pids)}`); }
// the engine: every agent node runs in the sandbox, its allowlist from policy egress.allow; only a signed captain grant turns it off
{ const { harness, until, Y } = await import("./rt-harness");
  const say = `PROBE ${JSON.stringify({ outside: join(data, "outside2.txt"), granted: "registry.example.test", badHost: "evil.example" })}`;
  const H = await harness([Y({ id: "sb", name: "sb", roles: [{ id: "w", label: "W", skill: "x" }], policies: { egress: { allow: ["registry.example.test"] } }, nodes: [
    { id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "a", kind: "agent", label: "A", role: "w", mode: "test", args: { say }, x: 1, y: 0 },
    { id: "e", kind: "hook", label: "E", x: 2, y: 0 }], edges: [["s", "a"], ["a", "e"]] })]);
  H.agents.egress = egress; H.agents.toolUrl = () => H.toolUrl; H.agents.protect = () => [protectedRoot];
  (H.engine as any).deps.provider = () => provider;
  const jobOf = (id: string) => { const jid = H.engine.get(id)!.nodes.a.data.jobs?.[0]?.id; return jid ? H.agents.jobs.get(jid) : null; };
  const run1 = H.engine.start({ workflow: "sb", text: "x" }); await until(() => ["succeeded", "failed"].includes(H.engine.get(run1.id)!.status), 30000);
  const j1 = jobOf(run1.id); let a: any = {}; try { a = JSON.parse(j1?.said ?? ""); } catch {}
  ok(a.wroteOutside === false && /^http:\/\/127\.0\.0\.1:\d+$/.test(a.proxyEnv ?? "") && a.proxyGranted !== undefined && a.proxyGranted !== 403 && a.proxyRefused === 403,
    "the engine runs an agent node in the round sandbox, with the hosts policy egress.allow grants for that run", JSON.stringify([j1?.status, j1?.error, a.wroteOutside, a.proxyGranted, a.proxyRefused]));
  H.engine.grants.add({ kinds: ["sandbox-off"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
  const run2 = H.engine.start({ workflow: "sb", text: "x" }); await until(() => ["succeeded", "failed"].includes(H.engine.get(run2.id)!.status), 30000);
  const j2 = jobOf(run2.id); let b: any = {}; try { b = JSON.parse(j2?.said ?? ""); } catch {}
  const said = JSON.stringify(H.engine.events(run2.id));
  ok(b.wroteOutside === true && !b.proxyEnv && /outside the round sandbox: the captain's grant G-/.test(said), "only a signed captain grant (sandbox-off) runs a round outside the sandbox, and the run says so", JSON.stringify([b.wroteOutside, b.proxyEnv]));
  H.stop(); }
const { diagnose } = await import("../src/doctor");
const di = (eg: { running: boolean; port: number; rounds: number }) => diagnose({ state: data, board: { writable: false }, gh: { connected: false, tokenSource: null, enabled: false }, keys: { anthropic: null, openai: null, compatBaseUrl: null }, chatProvider: "stub", lanIp: null,
  tailscale: { installed: false, running: false, dnsName: null }, compiled: false, egress: eg }).find((i) => i.id === "round-sandbox");
const item = di(egress.status());
ok(item?.status === "ok" && /proxy on 127\.0\.0\.1:\d+/.test(item.detail), "the Doctor shows the round sandbox and the proxy", JSON.stringify(item));
process.env.CREW_FORCE_NO_SANDBOX = "1";
const off = await agents.run({ kind: "t", title: "off", system: "s", text: "PROBE {}", tools: [], provider, timeoutMs: 5000, sandbox: { writes: [wt] } });
ok(off.status === "failed" && /refused/.test(off.error ?? ""), "without an OS sandbox a sandboxed round is refused, never run bare", off.error ?? "");
ok(di(egress.status())?.status === "missing", "and the Doctor says the round sandbox is missing");
{ const rlOf = (roundLogin: any) => diagnose({ state: data, board: { writable: false }, gh: { connected: false, tokenSource: null, enabled: false }, keys: { anthropic: null, openai: null, compatBaseUrl: null }, chatProvider: "stub", lanIp: null,
    tailscale: { installed: false, running: false, dnsName: null }, compiled: false, egress: egress.status(), roundLogin } as any).find((i) => i.id === "round-login")?.status;
  const st = [rlOf({ ok: true, verified: false, source: "the crew's token (keychain item crew-studio-claude-token)", warn: "crew keychain item present, but its content is checked when a round starts" }), rlOf({ ok: true, verified: true, source: "x", warn: null }), rlOf({ ok: false, error: "crew token is not a claude setup-token result" })];
  ok(JSON.stringify(st) === JSON.stringify(["degraded", "ok", "missing"]), "the Doctor's round login: warn (degraded) while the crew item is present but no round has signed in with it, ok once one has, fail (missing) when the last outcome failed and nothing later works", JSON.stringify(st)); }
delete process.env.CREW_FORCE_NO_SANDBOX;
egress.stop(); main.stop(); tools.stop();
// Studio itself: the proxy and the tool listener start with it, its page hands out no session, the Doctor shows the keychain sign-in
{ const { spawn } = await import("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "crew-roundboot-")); for (const x of ["state", "home", "proj", "data"]) mkdirSync(join(tmp, x));
  const leftHome = join(tmp, "data", "rounds", "Jold", "home"); mkdirSync(leftHome, { recursive: true }); writeFileSync(join(leftHome, "auth.json"), "a copied login");
  writeFileSync(kcCalls, ""); // the Doctor's own keychain calls, from here on
  const port = await freePort();
  const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_DATA: join(tmp, "data"), CREW_PORT: String(port), CREW_FM_STATE: join(tmp, "state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_SANDBOX: "0", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp, CREW_SESSION_TOKEN: "boot-session" } });
  const base = `http://127.0.0.1:${port}`;
  await waitUp(base, app); const items: any[] = (await (await fetch(`${base}/api/doctor`, { headers: { "x-crew-session": "boot-session" } })).json()).items;
  const page = await fetch(`${base}/`); const bad = await fetch(`${base}/session?t=wrong`, { redirect: "manual" }); const good = await fetch(`${base}/session?t=boot-session`, { redirect: "manual" });
  // defence in depth behind the loopback rule (architecture §10): a local process without the session cannot answer a card
  const answer = await fetch(`${base}/api/scards/x/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: "approve" }) });
  app.kill();
  const it = items.find((i) => i.id === "round-sandbox"), kc = items.find((i) => i.id === "round-login");
  ok(it?.status === "ok" && /proxy on 127\.0\.0\.1:\d+/.test(it.detail), "Studio starts the egress proxy with itself, and its Doctor shows the round sandbox", JSON.stringify(it));
  ok(!existsSync(leftHome), "at start Studio removes the throwaway homes and tmp an earlier Studio's rounds left behind");
  const calls = readFileSync(kcCalls, "utf8").trim().split("\n").filter(Boolean);
  ok(calls.length > 0 && calls.every((c) => !/(^| )-w( |$)/.test(c)), "the Doctor's status never decrypts a login: it asks the keychain whether the item exists (no -w)", JSON.stringify(calls));
  ok(kc?.title === "Vendor token handed to rounds; keychain not reachable" && kc.status === "degraded" && /crew-studio-claude-token/.test(kc.detail) && /checked when a round starts/.test(kc.detail), "the Doctor says rounds get the vendor token Studio hands them, and no keychain; an untried crew keychain item is a warn", JSON.stringify(kc));
  ok(page.status === 200 && !page.headers.get("set-cookie") && bad.status === 403 && !bad.headers.get("set-cookie") && good.status === 303 && good.headers.get("set-cookie") === sessionCookie("boot-session"),
    "Studio's page hands out no session; only its session link (`crew-studio open`) starts one", JSON.stringify([page.headers.get("set-cookie"), bad.status, good.status]));
  ok(answer.status === 403, "Studio refuses a card answer without its session (POST /api/scards/x/answer → 403), so a local process that reached its port still could not answer for the captain", String(answer.status)); }
// a captain who chose API billing with the earlier switch keeps it
{ const { spawn } = await import("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "crew-billing-")); for (const x of ["state", "home", "proj", "data"]) mkdirSync(join(tmp, x));
  writeFileSync(join(tmp, "data", "round-auth.json"), JSON.stringify({ claude: "api-key", by: "captain (desktop)" })); writeFileSync(join(tmp, "data", "keys.json"), JSON.stringify({ anthropic: "sk-ant-api03-billing-fixture-0123456789" }));
  const port = await freePort(); const env: any = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_DATA: join(tmp, "data"), CREW_PORT: String(port), CREW_FM_STATE: join(tmp, "state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_SANDBOX: "0", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp, CREW_SESSION_TOKEN: "billing-session" } });
  await waitUp(`http://127.0.0.1:${port}`, app); const items: any[] = (await (await fetch(`http://127.0.0.1:${port}/api/doctor`, { headers: { "x-crew-session": "billing-session" } })).json()).items; app.kill();
  const rl = items.find((i) => i.id === "round-login");
  ok(rl?.status === "ok" && /API key \(API billing\)/.test(rl.detail) && !existsSync(join(tmp, "data", "round-auth.json")) && JSON.parse(readFileSync(join(tmp, "data", "claude-billing.json"), "utf8")).billing === "api-key",
    "a captain who chose API billing with the earlier switch keeps it (moved to data/claude-billing.json), never switched silently", JSON.stringify(rl)); }
console.log(`\nround-sandbox: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
