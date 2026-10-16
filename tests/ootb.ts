import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Out-of-the-box checks: the GitHub REST client (no gh CLI) against a mock API,
// the Doctor with each dependency missing, the installer runner (mocked: nothing
// is ever installed), and the LAN listener's Host rules.   bun tests/ootb.ts
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN"]) delete process.env[k];
process.env.CREW_GH_NO_CLI = "1";

// ---------- GitHub REST client against a mock API ----------
const seen: { path: string; auth: string | null }[] = [];
let limited = false;
const gapi = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
  const u = new URL(req.url), p = u.pathname; seen.push({ path: p + u.search, auth: req.headers.get("authorization") });
  if (req.headers.get("authorization") !== "Bearer good_token_1234567890abcd") return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
  if (limited) return new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  if (p === "/repos/o/r") return Response.json({ full_name: "o/r" });
  if (p === "/repos/o/r/pulls" && u.searchParams.get("state") === "open") return Response.json([{ number: 7, title: "T-9: thing", head: { ref: "t-9", sha: "abc123" }, draft: false, updated_at: "2026-10-14T00:00:00Z", html_url: "https://github.com/o/r/pull/7" }]);
  if (p === "/repos/o/r/pulls/7") return Response.json({ mergeable_state: "clean" });
  if (p === "/repos/o/r/commits/abc123/check-runs") return Response.json({ check_runs: [{ name: "ci", status: "completed", conclusion: "success", html_url: "u1" }, { name: "e2e", status: "in_progress", conclusion: null, html_url: "u2" }, { name: "lint", status: "completed", conclusion: "failure", html_url: "u3" }] });
  if (p.endsWith("/status")) return Response.json({ statuses: [{ context: "legacy", state: "success", target_url: "u4" }] });
  if (p === "/repos/o/r/pulls" && u.searchParams.get("state") === "closed") return Response.json([
    { number: 5, title: "merged one", merged_at: "2026-10-13T10:00:00Z", merge_commit_sha: "m5", html_url: "h5", head: { ref: "b5", sha: "s5" } },
    { number: 4, title: "closed, not merged", merged_at: null, html_url: "h4", head: { ref: "b4", sha: "s4" } },
    { number: 6, title: "merged later", merged_at: "2026-10-13T12:00:00Z", merge_commit_sha: "m6", html_url: "h6", head: { ref: "b6", sha: "s6" } }]);
  if (/\/commits\/s[56]\/check-runs/.test(p)) return Response.json({ check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] });
  return new Response("{}", { status: 404 });
} });
process.env.CREW_GITHUB_API = `http://127.0.0.1:${gapi.port}`;
const { GitHub, findToken, NOT_CONNECTED } = await import("../src/github");
const data = mkdtempSync(join(tmpdir(), "crew-ootb-"));
const g = new GitHub("o/r", true, data);
const changes: any[] = [];
g.onChange = (s) => changes.push(s);
g.start();
ok(!g.state.connected && g.state.error === NOT_CONNECTED && g.state.tokenSource === null, "no token anywhere: GitHub not connected, no error loop", JSON.stringify(g.state));
ok(seen.length === 0, "not connected: no request to GitHub at all");
const bad = await g.saveToken("bad_token_1234567890abcdef");
ok(!bad.ok && /401/.test(bad.error ?? ""), "a refused token is not saved", JSON.stringify(bad));
let saved = false; try { statSync(join(data, "github-token")); saved = true; } catch {}
ok(!saved, "nothing written for a refused token");
ok(!(await g.saveToken("x")).ok, "a malformed token is rejected before any request");
const good = await g.saveToken("good_token_1234567890abcd");
ok(good.ok, "a working token is accepted", JSON.stringify(good));
ok((statSync(join(data, "github-token")).mode & 0o777) === 0o600, "the saved token file is 0600");
ok(findToken(data).source === "settings", "the saved token is found next time (source: settings)");
for (let i = 0; i < 50 && !g.state.ok; i++) await Bun.sleep(50);
ok(g.state.connected && g.state.ok && g.state.tokenSource === "settings", "connected and synced through the REST API", JSON.stringify({ ok: g.state.ok, err: g.state.error }));
const pr = g.state.prs[0];
ok(pr?.number === 7 && pr.head === "abc123" && pr.branch === "t-9" && pr.mergeState === "CLEAN" && pr.url.endsWith("/pull/7"), "open PR fields map from REST", JSON.stringify(pr));
const bk = Object.fromEntries((pr?.checks ?? []).map((c) => [c.name, c.bucket]));
ok(bk.ci === "pass" && bk.e2e === "pending" && bk.lint === "fail" && bk.legacy === "pass", "check runs and commit statuses become pass/pending/fail buckets", JSON.stringify(bk));
ok(g.merged.length === 2 && g.merged[0].number === 6 && g.merged[1].commit === "m5" && g.merged[0].checks.pass === 2 && g.merged[0].checks.fail === 0, "merged PRs: closed-but-unmerged dropped, newest first, with check rollups", JSON.stringify(g.merged.map((m) => m.number)));
ok(seen.filter((s) => s.path.startsWith("/repos")).every((s) => s.auth?.startsWith("Bearer ")), "every API call carries the token");
process.env.GITHUB_TOKEN = "env_token_x"; ok(findToken(data).source === "env", "an env token wins over the saved one"); delete process.env.GITHUB_TOKEN;
limited = true; g.stop(); g.start(); await (g as any).tick(); g.stop();
ok(!g.state.ok && g.state.rateLimited && !!g.state.backoffUntil, "a rate limit backs off and says so", JSON.stringify({ e: g.state.error, b: g.state.backoffUntil }));
g.forgetToken(); g.stop();
ok(!g.state.connected && findToken(data).source === null, "forgetting the token disconnects");
gapi.stop(true);

// ---------- the Doctor with each dependency missing ----------
const { diagnose, methodsFor, Installs, MockRunner, RealRunner, INSTALLERS } = await import("../src/doctor");
const empty = mkdtempSync(join(tmpdir(), "crew-nostate-"));
const items = diagnose({ state: empty, board: { writable: false, readonlyReason: "no board secret file" }, gh: { connected: false, tokenSource: null, enabled: true },
  keys: { anthropic: null, openai: null, compatBaseUrl: null }, chatProvider: "claude", lanIp: null, tailscale: { installed: false, running: false, dnsName: null },
  claudeBin: "/nonexistent/claude", codexBin: "/nonexistent/codex", compiled: true });
const by = Object.fromEntries(items.map((i) => [i.id, i]));
ok(by.state.status === "missing", "no state folder: missing");
ok(by.board.status === "degraded" && /read-only/.test(by.board.detail), "no board: degraded, read-only");
ok(by.claude.status === "missing" && by.claude.action.kind === "install", "no claude: missing, with Install");
ok(by.codex.status === "missing" && by.codex.action.kind === "install", "no codex: missing, with Install");
ok(by.chat.status === "degraded" && by.keys.status === "degraded" && by.keys.action.kind === "keys", "no CLI and no key: the status chat is degraded and points to keys");
ok(by.main.status === "degraded" && /CLI/.test(by.main.detail), "no CLI: the main session says it needs one");
ok(by.github.status === "degraded" && by.github.action.kind === "github", "GitHub not connected: degraded, with Connect");
ok(by.lan.status === "degraded", "no LAN address: LAN mode degraded");
ok(by.tailscale.status === "info" && by.tailscale.action.kind === "install", "no Tailscale: optional, with Install");
ok(by.assets.status === "ok" && /embedded/.test(by.assets.detail), "assets are embedded in the binary");
const withKey = Object.fromEntries(diagnose({ state: empty, board: { writable: true }, gh: { connected: true, tokenSource: "env", enabled: true }, keys: { anthropic: "settings", openai: null, compatBaseUrl: null },
  chatProvider: "anthropic", lanIp: "10.0.0.5", tailscale: { installed: true, running: false, dnsName: null }, claudeBin: "/nonexistent/claude", codexBin: "/nonexistent/codex", compiled: false }).map((i) => [i.id, i]));
ok(withKey.chat.status === "ok" && withKey.keys.status === "ok", "an API key alone makes the status chat work without any CLI");
ok(withKey.tailscale.status === "degraded" && withKey.tailscale.action.kind === "login", "Tailscale installed but signed out: Sign in");
ok(Object.keys(INSTALLERS).includes("linux") && Object.keys(INSTALLERS).includes("win32"), "the installer table is per OS (darwin, linux, win32)");
const all = Object.values(INSTALLERS).flatMap((o) => Object.values(o).flat());
ok(all.every((m) => !m.argv.includes("sudo") && !m.argv.join(" ").includes("sudo ")), "no installer uses sudo");
ok(all.filter((m) => /curl .*\| *(ba)?sh/.test(m.argv.join(" "))).every((m) => /https:\/\/claude\.ai\/install\.sh/.test(m.argv.join(" "))), "the only piped script is the vendor's official installer on its own host");
const ms = methodsFor("claude", "darwin");
ok(ms.length >= 2 && ms.every((m, i) => i === 0 || Number(ms[i - 1].usable) >= Number(m.usable)), "usable installers sort first");
ok(methodsFor("tailscale", "darwin").some((m) => m.kind === "open" && /tailscale\.com\/download/.test(m.url ?? "")), "Tailscale offers the official download page");

// ---------- installs: mocked runner, never a real install ----------
const runner = new MockRunner();
const inst = new Installs(runner);
const lines: string[] = [];
inst.onChange = (_j, l) => { if (l) lines.push(l); };
let finished: any = null; inst.onFinished = (j) => { finished = j; };
const m0 = methodsFor("codex", "darwin")[0];
const job = inst.start("codex", m0);
let busyRefused = false; try { inst.start("codex", m0); } catch { busyRefused = true; }
ok(busyRefused, "one install at a time");
for (let i = 0; i < 60 && !finished; i++) await Bun.sleep(50);
ok(finished?.state === "done" && finished.code === 0, "a mocked install finishes", JSON.stringify(finished?.state));
ok(lines.length >= 3 && /would run: /.test(lines[0]), "the log streams line by line", JSON.stringify(lines));
ok(runner.ran.length === 1 && runner.ran[0].join(" ") === m0.argv.join(" "), "the runner received exactly the shown command");
finished = null; process.env.CREW_MOCK_INSTALL = "fail";
inst.start("codex", m0);
for (let i = 0; i < 60 && !finished; i++) await Bun.sleep(50);
ok(finished?.state === "failed" && finished.code === 1 && finished.lines.some((l: string) => /failed/.test(l)), "a failing install shows failed with its log");
process.env.CREW_MOCK_INSTALL = "";
finished = null;
const j3 = inst.start("codex", m0);
await Bun.sleep(80);
ok(inst.cancel(j3.id), "cancel stops the running install");
for (let i = 0; i < 40 && !finished; i++) await Bun.sleep(25);
ok(finished?.state === "cancelled", "a cancelled install says cancelled", JSON.stringify(finished?.state));
process.env.CREW_NO_REAL_INSTALL = "1";
let refused = false; try { new RealRunner().run(["/usr/bin/true"], () => {}); } catch { refused = true; }
ok(refused, "the real runner refuses when installs are disabled (tests)");
void job;

// ---------- LAN listener Host rules ----------
const { Remote } = await import("../src/remote/pairing");
const rd = mkdtempSync(join(tmpdir(), "crew-lan-"));
const r = new Remote(rd, 4210);
const req = (host: string, token?: string) => new Request(`http://${host}/api/summary`, { headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const U = new URL("http://x/api/summary");
ok(r.who(req("127.0.0.1:4210"), U, "loopback").kind === "desktop", "loopback Host on the loopback listener is this Mac");
ok((r.who(req("127.0.0.1:4210"), U, "lan") as any).status === 421, "the LAN listener refuses a loopback Host (a phone cannot claim to be the Mac)");
ok((r.who(req("10.0.0.5:4210"), U, "lan") as any).status === 421, "LAN mode off: its address is refused");
r.lanHost = "10.0.0.5:4210";
ok((r.who(req("10.0.0.5:4210"), U, "lan") as any).status === 401, "LAN mode on: no token means pair first");
const c = r.startPairing(); const pr2 = r.pair(c.code, "phone");
ok(pr2.ok && r.who(req("10.0.0.5:4210", (pr2 as any).token), U, "lan").kind === "phone", "a paired phone on the LAN is a phone");
ok((r.who(req("10.0.0.5:4210"), U, "loopback") as any).status === 421, "the LAN address is not accepted on the loopback listener");

// Execute the actual Doctor renderer with source-created status facts. No browser
// or vendor request; assert labels/actions rather than source substring matches.
const {runInNewContext}=await import('node:vm');
for(const locale of['en','zh-TW'])for(const state of['exhausted','signed-in','context-unknown']){
 const calls:string[]=[],routes:any={remote:()=>({})},node=()=>({append(){},addEventListener(){},replaceChildren(){}}),cap={provider:'claude',quota:state==='exhausted'?'exhausted':'unknown',loginState:state==='context-unknown'?'unknown':'logged-in',resetAt:null};
 const context:any={routes,S:{route:{name:'other'}},window:{},location:{hash:''},T:(en:string,zh:string)=>locale==='en'?en:zh,$:()=>node(),h:(tag:any,attrs:any,...children:any[])=>({...node(),tag,attrs,children:children.flat(Infinity)}),icon:()=>'',getJ:async(path:string)=>{calls.push(path);return path==='/api/claude/account'?{state:'idle',reason:'',reasonZh:''}:path.includes('/claude/')?cap:{items:[{id:'claude',title:'Claude',status:'ok',action:{kind:'login',item:'claude'}}]};},viewRemote:()=>node(),driverBanner:()=>({}),ghBar:()=>({}),postJ:()=>{throw new Error('passive Doctor made a write');},setInterval(){},setTimeout(){},addEventListener(){},dispatchEvent(){},toast(){},MS:{me:{kind:'desktop'}},render(){}};context.window.liveListen=()=>{};
 // the Doctor's one Claude card is the shared account panel (public/takeover.js); run that fragment with the Doctor
 const takeover=readFileSync(join(import.meta.dirname,'../public/takeover.js'),'utf8'),from=takeover.indexOf('// Claude: status from'),to=takeover.indexOf('\n',takeover.indexOf('addEventListener("crew:live",',from));
 if(locale==='en'&&state==='exhausted')ok(from>0&&to>from,'the shared Claude panel fragment is found in public/takeover.js');
 runInNewContext(takeover.slice(from,to),context);runInNewContext(readFileSync(join(import.meta.dirname,'../public/ootb.js'),'utf8'),context);await new Promise(r=>setTimeout(r,0));routes.doctor();await new Promise(r=>setTimeout(r,0));
 const rendered=JSON.stringify(routes.doctor());
 ok(calls.every(p=>p==='/api/doctor'||p==='/api/claude/native/status'||p==='/api/claude/account'),'Doctor metadata never invokes paid Verify: '+locale+'/'+state);
 ok(rendered.includes(locale==='en'?'Detected':'已偵測')&&!rendered.includes(locale==='en'?'"Works"':'"可用"'),'Claude binary detection is separate from worker readiness: '+locale+'/'+state);
 if(state==='exhausted')ok(rendered.includes(locale==='en'?'Reset time unknown':'重設時間未知')&&rendered.includes('data-claude-wait-reset')&&!rendered.includes('data-login'),'exhausted account waits for unknown reset instead of relogin: '+locale);
 if(state==='signed-in')ok(rendered.includes(locale==='en'?'signed in. Remaining quota is unknown':'已登入。剩餘額度未知'),'signed-in metadata does not fabricate quota: '+locale);
 if(state==='context-unknown')ok(rendered.includes(locale==='en'?'does not mean the machine is globally logged out':'不代表整台機器都已登出'),'unknown process context is not global logout: '+locale);
}
console.log(`\nootb: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
