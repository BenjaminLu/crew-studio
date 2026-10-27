import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// M2.5 tests: the host contract for both vendors (through stub CLIs), the
// driver lock, the input queue and wakes, the permission bridge, and phone
// pairing. No real claude, codex or tailscale state is touched: HOME points at
// a temporary folder, the host CLIs are stubs, the live session is never named.
//   bun tests/host.ts
import { homedir } from "node:os";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, utimesSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

const here = import.meta.dir, root = join(here, "..");
const TMP = mkdtempSync(join(tmpdir(), "crew-host-"));
process.env.CREW_WAKE_GRACE_MS ??= "0"; // these tests have no firstmate hook to wait for
process.env.HOME = TMP; // stubs and discovery read $HOME/.claude/projects; nothing real is reachable
const LIVE = "765c03ed-4b7b-4b15-ae1e-2a255f291ca0";

const { claudeHost, encodeCwd } = await import("../src/host/claude");
const { codexHost } = await import("../src/host/codex");
const { PermissionBridge } = await import("../src/host/permission");
const { InputQueue, wakeText } = await import("../src/host/queue");
const { WakeReader, wakeLine } = await import("../src/host/wakes");
const { MainSession } = await import("../src/host/main");
const { driving } = await import("../src/host/probe");
const { Remote } = await import("../src/remote/pairing");
const { StubRunner, serveCommand } = await import("../src/remote/tailscale");
import type { HostEvent } from "../src/host/types";

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await Bun.sleep(25); return f(); };

const PROJ = join(TMP, "proj"); mkdirSync(PROJ);
const PROJECTS = join(TMP, ".claude/projects"), PDIR = join(PROJECTS, encodeCwd(PROJ));
mkdirSync(PDIR, { recursive: true });
const seed = (id: string, title: string, ageMs = 3_600_000) => {
  const f = join(PDIR, `${id}.jsonl`);
  writeFileSync(f, JSON.stringify({ type: "user", isSidechain: false, cwd: PROJ, sessionId: id, message: { role: "user", content: title } }) + "\n");
  const t = (Date.now() - ageMs) / 1000; utimesSync(f, t, t); return f;
};
seed("sess-old", "An older firstmate session", 7_200_000);
seed("sess-main", "firstmate main session", 3_600_000);
seed("fork-sess", "A session that gets re-identified", 9_000_000);
writeFileSync(join(PDIR, "agent-xyz.jsonl"), "{}\n");

const CLAUDE_STUB = join(here, "stub-host-claude.mjs"), CODEX_STUB = join(here, "stub-host-codex.mjs");
const claude = claudeHost(CLAUDE_STUB, PROJECTS), codex = codexHost(CODEX_STUB);
const bridge = new PermissionBridge(1500);
await bridge.listen();
const permMcp = { command: [process.execPath, join(root, "src/permission-mcp.ts")], env: { CREW_PERM_SOCKET: bridge.socket, CREW_PERM_TOKEN: bridge.token } };

// ---------- host contract, both vendors ----------
for (const [host, id] of [[claude, "sess-main"], [codex, "th-stub-1"]] as const) {
  const tag = host.id;
  const found = await host.discover(PROJ);
  ok(found.some((s) => s.id === id) && found.every((s) => !s.id.startsWith("agent-")), `${tag}: discover lists the project's sessions (no subagent files)`, JSON.stringify(found.map((s) => s.id)));
  const ev: HostEvent[] = [];
  let answerPerm = true;
  const s = await host.attach(id, { cwd: PROJ, onEvent: (e) => ev.push(e), onPermission: (r) => (tag === "claude" ? bridge.ask(r) : Promise.resolve({ allow: answerPerm })), permissionMcp: permMcp });
  const r1 = await s.send("hello there");
  ok(r1.status === "completed", `${tag}: send resolves when the turn completes`, JSON.stringify(r1));
  const text = ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("");
  ok(text === "echo: hello there" && ev.some((e) => e.type === "message") && ev.at(-1)?.type === "turnEnd", `${tag}: deltas stream in order, then message, then turnEnd`, JSON.stringify(text));
  ok(s.id === id && !s.busy, `${tag}: the attached id is kept and the session is idle after the turn`);
  ev.length = 0;
  await s.send("STUB_THINK");
  const thought = ev.filter((e) => e.type === "thinking").map((e: any) => e.text).join(""), firstThink = ev.findIndex((e) => e.type === "thinking"), firstDelta = ev.findIndex((e) => e.type === "delta");
  ok(thought === "weighing the ask" && firstThink >= 0 && firstThink < firstDelta, `${tag}: the model's reasoning streams as thinking events before the reply`, JSON.stringify(ev.map((e) => e.type)));
  // second turn on the same process: the conversation carries on
  ev.length = 0;
  const r2 = await s.send("second");
  ok(r2.status === "completed" && ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("") === "echo: second", `${tag}: a second turn runs on the same session`);
  // busy refusal at the host level (the queue above never sends twice)
  const p3 = s.send("STUB_SLOW");
  let busyThrew = false; try { await s.send("again"); } catch (e: any) { busyThrew = /BUSY/.test(e.message); }
  ok(busyThrew, `${tag}: the host refuses a second send while a turn runs`);
  await until(() => ev.some((e) => e.type === "delta" && (e as any).text === "."));
  const t0 = Date.now();
  await s.interrupt();
  const r3 = await p3;
  ok(r3.status === "interrupted" && Date.now() - t0 < 6000, `${tag}: interrupt() ends the running turn as interrupted`, JSON.stringify(r3));
  // permission request: allow, then deny
  ev.length = 0;
  if (tag === "claude") {
    const allowP = s.send("STUB_TOOL");
    await until(() => bridge.pending().length === 1);
    const req = bridge.pending()[0];
    ok(req?.tool === "Bash" && /ls -la/.test(req.summary), `${tag}: a tool permission request reaches Studio through the permission MCP`, JSON.stringify(req));
    bridge.answer(req.id, true);
    const ra = await allowP;
    ok(ra.status === "completed" && /Ran ls/.test(ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("")), `${tag}: allow lets the tool run`);
    ev.length = 0;
    const denyP = s.send("STUB_TOOL");
    await until(() => bridge.pending().length === 1);
    bridge.answer(bridge.pending()[0].id, false);
    await denyP;
    ok(/Not allowed: denied by the captain/.test(ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("")), `${tag}: deny reaches the session as a refusal`);
    ev.length = 0;
    await s.send("STUB_TOOL"); // nobody answers: the bridge's 1.5 s timeout denies
    ok(/Not allowed: no answer from the captain in time/.test(ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("")), `${tag}: no answer in time is a deny`);
  } else {
    answerPerm = true; await s.send("STUB_TOOL");
    ok(/Ran ls/.test(ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("")) && ev.some((e) => e.type === "toolStart" && (e as any).name === "commandExecution"), `${tag}: an approval request answered allow lets the command run`);
    ev.length = 0; answerPerm = false; await s.send("STUB_TOOL");
    ok(/Not allowed/.test(ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("")), `${tag}: an approval answered deny declines the command`);
  }
  const cmd = await s.detach();
  ok(cmd === (tag === "claude" ? `claude --resume ${id}` : `codex resume ${id}`), `${tag}: detach returns the terminal resume command`, cmd);
  // fork-follow
  const fev: HostEvent[] = [];
  const f = await host.attach(tag === "claude" ? "fork-sess" : "fork-th", { cwd: PROJ, onEvent: (e) => fev.push(e), onPermission: async () => ({ allow: false }), permissionMcp: permMcp });
  await f.send("hi");
  const fk = fev.find((e) => e.type === "forked") as any;
  ok(fk && f.id === fk.newId && f.id.endsWith("-new"), `${tag}: a re-identified session is followed to its new id`, JSON.stringify(fk));
  ok((await f.detach()).endsWith(f.id), `${tag}: detach after a fork resumes the new id`);
}
// no FM_/HERDR/CREW/secret variables reach the host process
{ const { cleanEnv } = await import("../src/host/types");
  const e = cleanEnv({ PATH: "/bin", HOME: "/h", FM_ROOT: "x", HERDR_ENV: "1", CREW_TOOL_TOKEN: "t", OPENAI_API_KEY: "k", GITHUB_TOKEN: "g", CLAUDECODE: "1", LANG: "C" });
  ok(JSON.stringify(Object.keys(e).sort()) === JSON.stringify(["HOME", "LANG", "PATH"]), "host processes get no FM_, HERDR, CREW, Claude-session or secret variables", JSON.stringify(e)); }
// the permission socket refuses a bad token
{ const { connect } = await import("node:net");
  const a = await new Promise<string>((res) => { const c = connect(bridge.socket); let b = ""; c.on("connect", () => c.write(JSON.stringify({ token: "nope", tool_name: "Bash", input: {} }) + "\n")); c.on("data", (d) => (b += d)); c.on("close", () => res(b)); });
  ok(/"allow":false/.test(a) && /bad token/.test(a) && bridge.pending().length === 0, "the permission socket denies a request with a bad token", a);
  ok((statSync(bridge.socket).mode & 0o777) === 0o600 && (statSync(bridge.dir).mode & 0o777) === 0o700, "the permission socket is 0600 inside a 0700 folder"); }

// ---------- queue and wakes ----------
{
  const q = new InputQueue();
  q.push("chat", "first", "desktop"); q.push("wake", "CI failed: T-1 #9", "firstmate"); q.push("card", "card: D-1 answered A", "desktop");
  q.push("wake", "review: T-1 APPROVE abc", "firstmate"); q.push("wake", "CI failed: T-1 #9", "firstmate");
  const l = q.list();
  ok(l.map((i) => i.kind).join(",") === "chat,wake,card", "the queue keeps arrival order and folds later wakes into the waiting wake", l.map((i) => i.kind).join(","));
  ok(l[1].lines!.join("|") === "CI failed: T-1 #9|review: T-1 APPROVE abc" && l[1].text === wakeText(l[1].lines!), "folded wakes keep each line once, in order");
  ok(q.shift()!.text === "first" && q.length === 2, "items leave one at a time");
  const st = join(TMP, "fmstate"); mkdirSync(join(st, "session"), { recursive: true });
  const wf = join(st, "session/wake.jsonl");
  writeFileSync(wf, JSON.stringify({ line: "old wake", id: "x" }) + "\n");
  const wr = new WakeReader(st);
  ok(wr.read().length === 0, "wakes written before Studio attached are not replayed");
  appendFileSync(wf, JSON.stringify({ reason: "round_end", line: "finished: T-305 worker-x ok #288" }) + "\n" + JSON.stringify({ reason: "answered", id: "D-5", decision: { chosen: "A" } }) + "\n" +
    JSON.stringify({ reason: "autopilot", summary: { en: "CI failed: T-305 #288 bash suites (shard 2/6) d9f3" } }) + "\n" + '{"partial":');
  ok(JSON.stringify(wr.read()) === JSON.stringify(["finished: T-305 worker-x ok #288", "card: D-5 answered A", "CI failed: T-305 #288 bash suites (shard 2/6) d9f3"]), "new wakes are read as the stop-hook's lines; a half-written line waits");
  ok(wakeLine({ reason: "merge_settled", id: "D-7", decision: { merge: "merged" } }) === "merge: D-7 merged", "wake lines match fm_watch.wake_line");
}

// ---------- driver lock and the main controller ----------
{
  const data = join(TMP, "data-main"); mkdirSync(data);
  const st = join(TMP, "fmstate");
  let procs: { pid: number; command: string; cwd: string | null }[] = [];
  const probe = { list: () => procs };
  const m = new MainSession({ dataDir: data, projectDir: PROJ, stateDir: st, probe, hosts: { claude, codex }, pollMs: 200,
    permissionMcp: (b) => ({ command: [process.execPath, join(root, "src/permission-mcp.ts")], env: { CREW_PERM_SOCKET: b.socket, CREW_PERM_TOKEN: b.token } }) });
  await m.start();
  // a terminal process naming the session: attach is refused
  procs = [{ pid: 999991, command: "claude --resume sess-main", cwd: PROJ }];
  let r = await m.attach("claude", "sess-main");
  ok(!r.ok && (r as any).code === "terminalDriving", "attach is refused while a terminal process names the session", JSON.stringify(r));
  const listed = await m.discover("claude");
  ok(listed.find((s) => s.id === "sess-main")?.possiblyOpen === true, "discover marks that session as possibly open, with the reason");
  // an interactive claude in the project folder holds the newest session
  procs = [{ pid: 999992, command: "claude", cwd: PROJ }];
  r = await m.attach("claude", "sess-main");
  ok(!r.ok && /interactive claude/.test((r as any).reason), "an interactive claude running in the project folder holds the newest session", JSON.stringify(r));
  // a session written in the last 3 minutes is held too
  procs = [];
  const recent = seed("sess-recent", "recent", 30_000);
  r = await m.attach("claude", "sess-recent");
  ok(!r.ok && /written \d+s ago/.test((r as any).reason), "a session file written in the last 3 minutes is treated as driven");
  void recent;
  // free: attach, lock written
  utimesSync(join(PDIR, "sess-recent.jsonl"), new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  r = await m.attach("claude", "sess-old");
  const drv = JSON.parse(readFileSync(join(data, "driver.json"), "utf8"));
  ok(r.ok && drv.holder === "studio" && drv.sessionId === "sess-old" && (statSync(join(data, "driver.json")).mode & 0o777) === 0o600, "attach writes the driver lock (holder studio, 0600)", JSON.stringify(drv));
  ok(!(await m.attach("claude", "sess-main")).ok, "a second attach is refused while Studio holds a session");
  // queue: chat + wake while busy are delivered in order, one turn each
  m.enqueue("chat", "STUB_SLOW", "desktop");
  await until(() => m.view().busy);
  m.enqueue("chat", "after slow", "desktop");
  appendFileSync(join(st, "session/wake.jsonl"), JSON.stringify({ line: "review: T-9 REJECT abc #1" }) + "\n" + JSON.stringify({ line: "CI failed: T-9 #1 shard 1" }) + "\n");
  await until(() => m.view().queue.some((q) => q.kind === "wake"));
  ok(m.view().queue.map((q) => q.kind).join(",") === "chat,wake" && m.view().queue[1].lines!.length === 2, "while a turn runs, input waits in order and the two wakes fold into one", JSON.stringify(m.view().queue.map((q) => q.kind)));
  await m.interrupt();
  await until(() => !m.view().busy && m.view().queue.length === 0, 15000);
  const log = m.view().log.filter((x) => x.kind !== "tool" && x.kind !== "system");
  const seq = log.map((x) => x.kind).join(",");
  ok(/captain,status,captain,firstmate,wake,firstmate/.test(seq), "turns ran one by one: slow (interrupted), then the chat, then the folded wake", seq);
  ok(log.some((x) => x.kind === "wake" && x.text.startsWith("firstmate wake:\nreview: T-9 REJECT abc #1\nCI failed: T-9 #1 shard 1\nHandle each event")), "the wake turn carries the stop-hook's text");
  // a foreign write while idle pauses Studio instead of forking
  await Bun.sleep(4200);
  appendFileSync(join(PDIR, "sess-old.jsonl"), JSON.stringify({ type: "user", message: { content: "typed in a terminal" } }) + "\n");
  await until(() => m.view().state === "paused", 4000);
  ok(m.view().state === "paused" && /changed while Studio was not running a turn/.test(m.view().pausedReason ?? ""), "a terminal writing the session while Studio holds it pauses Studio", m.view().pausedReason ?? "");
  m.enqueue("chat", "held while paused", "desktop");
  await Bun.sleep(400);
  ok(m.view().queue.length === 1 && !m.view().busy, "nothing is sent while paused");
  ok(m.resume().ok, "the captain can resume");
  await until(() => m.view().queue.length === 0 && !m.view().busy, 8000);
  ok(m.view().log.some((x) => x.kind === "firstmate" && x.text === "echo: held while paused"), "after resuming, the held input is delivered");
  const cmd = await m.detach();
  const d2 = JSON.parse(readFileSync(join(data, "driver.json"), "utf8"));
  ok(cmd === "claude --resume sess-old" && d2.holder === "terminal" && d2.resume === cmd && m.view().state === "detached", "hand back stops Studio's process, records holder terminal and the resume command", JSON.stringify(d2));
  m.stop();
}
// the live firstmate session is never touched by these tests
ok(!existsSync(join(PROJECTS, join(homedir(), "Desktop/firstmate-workflow").replace(/\//g, "-"), `${LIVE}.jsonl`)), "tests ran under a temporary HOME; the live session file is not in reach");

// ---------- phone pairing (unit) ----------
{
  const data = join(TMP, "data-remote"); mkdirSync(data);
  const rm = new Remote(data, 4210);
  rm.tailnetNames.add("mac.tail.ts.net");
  const req = (host: string, headers: Record<string, string> = {}, path = "/api/summary") => new Request(`http://127.0.0.1:4210${path}`, { headers: { host, ...headers } });
  ok(rm.who(req("127.0.0.1:4210"), new URL("http://x/")).kind === "desktop", "loopback Host without a token is this Mac");
  ok((rm.who(req("evil.example"), new URL("http://x/")) as any).status === 421, "an unknown Host is refused (DNS rebinding)");
  ok((rm.who(req("127.0.0.1:9999"), new URL("http://x/")) as any).status === 421, "loopback on another port is refused");
  ok((rm.who(req("mac.tail.ts.net"), new URL("http://x/")) as any).status === 401, "the tailnet name without a token must pair first");
  const t0 = Date.now();
  const c = rm.startPairing(t0);
  ok(/^\d{6}$/.test(c.code) && c.expires === t0 + 300_000, "a pairing code is 6 digits for 5 minutes");
  const wrong = c.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) rm.pair(wrong, "x", t0);
  const fifth = rm.pair(wrong, "x", t0);
  ok(!fifth.ok && rm.pair(c.code, "x", t0).ok === false, "after 5 wrong tries the code is dead, even the right code fails");
  const c2 = rm.startPairing(t0);
  ok(!rm.pair(c2.code, "x", t0 + 301_000).ok, "an expired code is refused");
  const c3 = rm.startPairing(t0);
  const p = rm.pair(c3.code, "Pixel", t0) as any;
  ok(p.ok && Buffer.from(p.token, "base64url").length === 32, "the right code pairs and returns a 32-byte token");
  const stored = readFileSync(join(data, "remote-devices.json"), "utf8");
  ok(!stored.includes(p.token) && stored.includes(new Bun.CryptoHasher("sha256").update(p.token).digest("hex")) && (statSync(join(data, "remote-devices.json")).mode & 0o777) === 0o600, "only the token's SHA-256 is stored, in a 0600 file");
  ok(!rm.pair(c3.code, "again", t0).ok, "a code works once");
  const w = rm.who(req("mac.tail.ts.net", { authorization: `Bearer ${p.token}` }), new URL("http://x/"));
  ok(w.kind === "phone" && (w as any).device.name === "Pixel", "the tailnet name with the token is that phone");
  ok(rm.who(req("mac.tail.ts.net"), new URL(`http://x/?token=${p.token}`)).kind === "phone", "?token= works for streams that cannot send headers");
  let cut = ""; rm.onRevoke = (id) => (cut = id);
  ok(rm.revoke(p.device.id) && cut === p.device.id && (rm.who(req("mac.tail.ts.net", { authorization: `Bearer ${p.token}` }), new URL("http://x/")) as any).status === 401, "revoking a device refuses its token and cuts its streams");
}
// ---------- tailscale is behind a runner; the stub never touches tailscale ----------
{ const s = new StubRunner(); const r = s.run(serveCommand(4210));
  ok(!s.live && s.ran.length === 1 && s.ran[0].join(" ") === "tailscale serve --bg --https=8443 http://127.0.0.1:4210" && /would run/.test(r.out), "the stub runner records `tailscale serve --bg --https=8443 http://127.0.0.1:4210` and runs nothing"); }

bridge.close();
console.log(`\nhost: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
