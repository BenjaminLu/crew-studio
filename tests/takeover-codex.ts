import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Codex as Studio's firstmate (docs/units/takeover-codex.md): discovery of both hosts,
// a Codex takeover that forks (thread/fork) or, where the app-server refuses a fork,
// starts a NEW thread seeded from a handoff, and never resumes or sends a turn to the
// live thread; the same driver lock, wakes, permission bridge (deny on any failure)
// and release as Claude; "Start firstmate on Codex" with the newest state/HANDOFF-*.md.
// The codex stub answers in the installed codex's protocol shapes and logs every message,
// and every protocol problem, so the assertions read what was really sent.
//   bun tests/takeover-codex.ts
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = import.meta.dir, root = join(here, "..");
const TMP = mkdtempSync(join(tmpdir(), "crew-takeover-codex-"));
process.env.HOME = TMP; process.env.CODEX_HOME = join(TMP, ".codex");
const { claudeHost, encodeCwd } = await import("../src/host/claude");
const { codexHost, codexConfig } = await import("../src/host/codex");
const { MainSession } = await import("../src/host/main");
const { createTakeover } = await import("../src/takeover");

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await Bun.sleep(25); return f(); };
const section = async (name: string, f: () => Promise<void>) => { try { await f(); } catch (e: any) { fail++; console.log(`  FAIL  ${name}: ${String(e?.message ?? e).split("\n")[0]}`); } };

await section("Codex config TOML syntax", async () => {
  const home = join(TMP, "config-parse"); mkdirSync(home);
  writeFileSync(join(home, "config.toml"), "model = 'literal-model'\nmodel_reasoning_effort = 'low'\nprofile = 'selected'\n[profiles.selected]\nmodel = 'profile-model'\nmodel_reasoning_effort = 'high'\n");
  const cfg = codexConfig(join(TMP, "no-project"), home);
  ok(cfg.model === "profile-model" && cfg.effort === "high", "config hints parse literal TOML strings and selected profiles");
});

// ---------- a temp firstmate repo: one Claude session, one live Codex thread, two handoff files ----------
const PROJ = join(TMP, "fm"); const ST = join(PROJ, "state"); mkdirSync(join(ST, "session/acknowledged"), { recursive: true });
writeFileSync(join(ST, "session/wake.jsonl"), "");
writeFileSync(join(ST, "HANDOFF-codex-2026-10-08.md"), "# Old codex handoff\nOLDER-HANDOFF-MARKER\n");
writeFileSync(join(ST, "HANDOFF-claude-2026-10-14.md"), "# Handoff 2026-10-14\nNEWEST-HANDOFF-MARKER: T-310 merge card D-310 waits for the captain.\n");
utimesSync(join(ST, "HANDOFF-codex-2026-10-08.md"), Date.now() / 1000 - 86400 * 6, Date.now() / 1000 - 86400 * 6);
mkdirSync(join(TMP, ".codex"), { recursive: true });
writeFileSync(join(TMP, ".codex/config.toml"), 'model = "gpt-cfg"\nmodel_reasoning_effort = "low"\n\n[profiles.fast]\nmodel = "not-this-one"\n');
const PROJECTS = join(TMP, ".claude/projects"), PDIR = join(PROJECTS, encodeCwd(PROJ)); mkdirSync(PDIR, { recursive: true });
writeFileSync(join(PDIR, "claude-fm-1.jsonl"), [
  { type: "user", isSidechain: false, cwd: PROJ, permissionMode: "auto", message: { role: "user", content: "firstmate on claude" } },
  { type: "assistant", isSidechain: false, cwd: PROJ, message: { role: "assistant", model: "model-x", content: [{ type: "text", text: "hi" }] } },
].map((o) => JSON.stringify(o)).join("\n") + "\n");
{ const t = Date.now() / 1000 - 7200; utimesSync(join(PDIR, "claude-fm-1.jsonl"), t, t); }
const LIVE = "019a1111-2222-7333-8444-555566667777";
const liveFile = join(TMP, "rollout-live.jsonl"); writeFileSync(liveFile, "{}\n"); { const t = Date.now() / 1000 - 3600; utimesSync(liveFile, t, t); }
process.env.STUB_CODEX_THREADS = JSON.stringify([{ id: LIVE, preview: "firstmate on codex: run the crew", cwd: PROJ, path: liveFile, model: "gpt-cfg", effort: "low", updatedAt: Math.floor(Date.now() / 1000) - 3600 }]);
process.env.STUB_CODEX_EFFORT = "low"; process.env.STUB_CODEX_MODEL = "gpt-cfg";
const LOG = join(TMP, "codex.log"); process.env.STUB_CODEX_LOG = LOG;
const readLog = () => existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const sent = (method: string) => readLog().filter((x) => x.dir === "in" && x.msg.method === method).map((x) => x.msg);
const problems: any[] = [];
const reset = () => { problems.push(...readLog().filter((x) => x.dir === "problem")); writeFileSync(LOG, ""); };

const claude = claudeHost(join(here, "stub-host-claude.mjs"), PROJECTS), codex = codexHost(join(here, "stub-host-codex.mjs"));
let n = 0;
const procs: { pid: number; command: string; cwd: string | null }[] = [];
const mk = (grace = 400) => new MainSession({ dataDir: (() => { const d = join(TMP, `data-${++n}`); mkdirSync(d); return d; })(), projectDir: PROJ, stateDir: ST,
  probe: { list: () => procs }, hosts: { claude, codex }, pollMs: 50, wakeGraceMs: grace,
  permissionMcp: (b) => ({ command: [process.execPath, join(root, "src/permission-mcp.ts")], env: { CREW_PERM_SOCKET: b.socket, CREW_PERM_TOKEN: b.token } }) });
const neverTheLive = () => readLog().filter((x) => x.dir === "in" && ["thread/resume", "turn/start", "turn/steer", "turn/interrupt", "thread/inject_items"].includes(x.msg.method) && x.msg.params?.threadId === LIVE);

// ---------- 1. discovery: both hosts, each labelled ----------
await section("discovery", async () => {
  const m = mk(); await m.start();
  const all = await (m as any).discoverAll();
  const c = all.find((s: any) => s.host === "claude"), x = all.find((s: any) => s.host === "codex");
  ok(c?.id === "claude-fm-1" && x?.id === LIVE, "discovery lists both Claude and Codex sessions, each with its host label", JSON.stringify(all.map((s: any) => [s.host, s.id])));
  ok(x?.updated > c?.updated && all[0].id === LIVE && /run the crew/.test(x.title) && x.effort === "low" && x.model === "gpt-cfg", "each session shows its last activity and summary, newest first; a Codex thread its model and effort", JSON.stringify(x));
  const tk = createTakeover({ main: m, fm: { title: () => "" } as any, gh: { state: { prs: [] }, merged: [] } as any, board: { status: () => ({}) } as any, stateDir: ST, pending: () => [], tasks: () => [], crew: () => [] });
  const r = await (await tk.handle(new Request("http://x/api/takeover"), new URL("http://x/api/takeover"), { kind: "desktop" }, false))!.json();
  ok(r.sessions?.some((s: any) => s.host === "codex") && r.sessions?.some((s: any) => s.host === "claude") && r.firstmate?.id === LIVE, "the Firstmate page's API lists both hosts", JSON.stringify(r.sessions?.map((s: any) => s.host)));
  ok(r.codex?.config?.model === "gpt-cfg" && r.codex?.config?.effort === "low" && r.codex?.handoffFile === "state/HANDOFF-claude-2026-10-14.md",
    "the page gets the captain's Codex model and effort (top-level keys only) and the newest handoff file", JSON.stringify(r.codex));
  m.stop();
});

// ---------- 2 and 3. a Codex takeover forks; lock, wakes, permission bridge, release ----------
await section("codex takeover by fork", async () => {
  reset();
  const m = mk(400); await m.start();
  const r: any = await m.takeover("codex" as any, LIVE, "takeover");
  ok(r.ok && r.path === "fork", "a Codex takeover is allowed and forks", JSON.stringify(r));
  const forks = sent("thread/fork");
  ok(forks.length === 1 && forks[0].params.threadId === LIVE, "the app-server is asked for thread/fork of the live thread", JSON.stringify(forks));
  ok(forks[0] && !["model", "approvalPolicy", "sandbox", "config", "baseInstructions", "developerInstructions"].some((k) => k in forks[0].params), "the fork passes no model, approval, sandbox or instructions: the captain's config decides", JSON.stringify(forks[0]?.params));
  const v = m.view() as any;
  const copy = v.sessionId;
  ok(copy && copy !== LIVE && v.drive?.path === "fork" && /forked/.test(v.drive?.statement ?? ""), "Studio drives the fork's own id and the view states it forked", JSON.stringify(v.drive));
  ok(v.drive?.model === "gpt-cfg" && v.drive?.effort === "low", "the view shows the model and effort the server reports", JSON.stringify(v.drive));
  const drv = JSON.parse(readFileSync(join(m.o.dataDir, "driver.json"), "utf8"));
  ok(drv.holder === "studio" && drv.host === "codex" && drv.forkedFrom === LIVE && drv.sessionId === copy && drv.path === "fork", "the driver lock names the Codex copy, the original and the path", JSON.stringify(drv));
  const note = readdirSync(join(m.o.dataDir, "handoff"));
  ok(note.length === 1 && readFileSync(join(m.o.dataDir, "handoff", note[0]), "utf8").includes(`The copy Studio drives is ${copy}`), "the handoff note names the Codex copy");
  ok(!(await m.takeover("codex" as any, LIVE, "takeover")).ok, "a second takeover is refused while Studio holds the lock");
  // a turn goes to the copy
  m.enqueue("chat", "T-310 status, one line", "desktop");
  await until(() => m.view().log.some((x) => x.kind === "firstmate"));
  ok(sent("turn/start").every((t: any) => t.params.threadId === copy) && sent("turn/start").length === 1, "the captain's turn goes to the copy");
  // wakes: an unacknowledged one is sent after the grace, an acknowledged one leaves the queue
  appendFileSync(join(ST, "session/wake.jsonl"), JSON.stringify({ id: "worker-c-t1-r1", reason: "finished", line: "worker: T-1 finished", woken: 1000 }) + "\n");
  await until(() => m.view().queue.some((q) => q.kind === "wake"), 3000);
  ok(m.view().queue.some((q) => q.kind === "wake") && m.view().log.some((x) => x.text === "wake: worker: T-1 finished"), "a wake reaches the Codex copy's queue and shows as a system line");
  await until(() => sent("turn/start").some((t: any) => /firstmate wake:\nworker: T-1 finished/.test(t.params.input?.[0]?.text ?? "")), 6000);
  ok(sent("turn/start").some((t: any) => t.params.threadId === copy && /firstmate wake:\nworker: T-1 finished/.test(t.params.input[0].text)), "an unacknowledged wake is sent to the Codex copy after the grace");
  await until(() => !m.view().busy);
  writeFileSync(join(ST, "session/acknowledged/worker-c-t2-r1.json"), JSON.stringify({ id: "worker-c-t2-r1", acknowledged: 2000 }));
  appendFileSync(join(ST, "session/wake.jsonl"), JSON.stringify({ id: "worker-c-t2-r1", reason: "finished", line: "worker: T-2 finished", woken: 1000 }) + "\n");
  await until(() => m.view().log.some((x) => /delivered by firstmate's own hook: worker: T-2 finished/.test(x.text)), 3000);
  ok(m.view().log.some((x) => /delivered by firstmate's own hook: worker: T-2 finished/.test(x.text)) && !sent("turn/start").some((t: any) => /T-2 finished/.test(t.params.input[0].text)), "a wake firstmate acknowledged leaves the queue and is not sent");
  // the permission bridge: an approval request reaches Studio; allow is sent back
  m.enqueue("chat", "STUB_TOOL", "desktop");
  await until(() => m.view().approvals.length > 0);
  const ap = m.view().approvals[0];
  ok(ap?.tool === "command" && /ls -la/.test(ap.summary), "a Codex approval request reaches Studio's permission bridge", JSON.stringify(ap));
  m.bridge.answer(ap.id, true);
  await until(() => m.view().log.some((x) => x.kind === "firstmate" && x.text === "Ran ls."));
  ok(readLog().some((x) => x.dir === "in" && x.msg.result?.decision === "accept"), "the captain's allow goes back as accept");
  // any failure denies: the bridge throws
  await until(() => !m.view().busy);
  const realAsk = m.bridge.ask.bind(m.bridge);
  (m.bridge as any).ask = () => Promise.reject(new Error("bridge down"));
  m.enqueue("chat", "STUB_TOOL", "desktop");
  await until(() => m.view().log.some((x) => x.kind === "firstmate" && x.text === "Not allowed."));
  ok(readLog().filter((x) => x.dir === "in" && x.msg.result?.decision).at(-1)?.msg.result.decision === "decline", "a failing permission bridge declines");
  (m.bridge as any).ask = realAsk;
  await until(() => !m.view().busy);
  // release
  const cmd = await m.detach();
  ok(cmd === `cd ${PROJ} && codex resume ${copy}`, "release returns `codex resume <id>` for the Studio-owned thread", cmd ?? "");
  const text = readFileSync(join(m.o.dataDir, "handoff", note[0]), "utf8");
  ok(/## Released/.test(text) && text.includes(`codex resume ${LIVE}\``), "the handoff note gets the release and the rollback to the original");
  const d2 = JSON.parse(readFileSync(join(m.o.dataDir, "driver.json"), "utf8"));
  ok(d2.holder === "terminal" && d2.host === "codex" && d2.resume === cmd, "the lock goes back to the terminal");
  ok(!neverTheLive().length, "a Codex takeover never sends thread/resume, or any turn, for the live thread id", JSON.stringify(neverTheLive()));
  m.stop();
});

await section("codex rehearsal", async () => {
  reset();
  const m = mk(); await m.start();
  ok((await m.takeover("codex" as any, LIVE, "rehearsal")).ok, "a Codex rehearsal starts");
  const starts = readLog().filter((x) => x.dir === "start"); // the first is discovery's short-lived app-server
  ok(starts.length === 2 && starts[1].FM_IN_ROUND === "1", "a Codex rehearsal runs the app-server with FM_IN_ROUND=1", JSON.stringify(starts));
  await m.detach(); m.stop();
});

// ---------- 2. no fork: a new thread seeded from a handoff ----------
await section("codex takeover without a fork", async () => {
  reset(); process.env.STUB_CODEX_NO_FORK = "1";
  const m = mk(); await m.start();
  const r: any = await m.takeover("codex" as any, LIVE, "takeover");
  ok(r.ok && r.path === "handoff" && r.statement === "Codex has no fork; Studio started a new thread from a handoff", "without a fork Studio starts a new thread and says so plainly", JSON.stringify(r));
  const v = m.view() as any;
  ok(v.drive?.path === "handoff" && v.drive?.statement === "Codex has no fork; Studio started a new thread from a handoff" && /method not found/.test(v.drive?.noFork ?? ""), "the view states the handoff path and why", JSON.stringify(v.drive));
  ok(sent("thread/turns/list").some((t: any) => t.params.threadId === LIVE) && sent("thread/start").length === 1, "the live thread's recent turns are read (thread/turns/list) and a new thread is started");
  await until(() => sent("turn/start").length > 0);
  const first = sent("turn/start")[0];
  ok(first && first.params.threadId === v.sessionId && first.params.threadId !== LIVE, "the seed goes to the new thread", JSON.stringify(first?.params?.threadId));
  const t = first?.params.input?.[0]?.text ?? "";
  ok(/T-310 is green; merge card D-310 raised/.test(t) && /Captain: firstmate: run the crew/.test(t) && t.indexOf("run the crew") < t.indexOf("T-310 is green"), "the seed holds the live thread's recent turns, oldest first", t.slice(0, 300));
  ok(t.includes("NEWEST-HANDOFF-MARKER") && !t.includes("OLDER-HANDOFF-MARKER") && t.includes("state/HANDOFF-claude-2026-10-14.md"), "the seed holds the newest state/HANDOFF-*.md");
  const note = readdirSync(join(m.o.dataDir, "handoff"))[0];
  ok(/Codex has no fork; Studio started a new thread from a handoff/.test(readFileSync(join(m.o.dataDir, "handoff", note), "utf8")), "the handoff note says which path Studio took");
  await until(() => !m.view().busy);
  ok(!neverTheLive().length, "without a fork, nothing is resumed or sent on the live thread either", JSON.stringify(neverTheLive()));
  ok((await m.detach()) === `cd ${PROJ} && codex resume ${v.sessionId}`, "release of the new thread returns its codex resume command");
  m.stop(); delete process.env.STUB_CODEX_NO_FORK;
});

await section("unsafe fork and unrelated approval", async () => {
  reset(); process.env.STUB_CODEX_SAME_FORK = "1";
  const m = mk(); await m.start();
  const r: any = await m.takeover("codex", LIVE, "takeover");
  ok(r.ok && r.path === "handoff" && m.view().sessionId !== LIVE, "a fork returning the live ID falls back to a distinct new thread");
  await until(() => !m.view().busy);
  await m.detach(); m.stop(); delete process.env.STUB_CODEX_SAME_FORK;
  process.env.STUB_CODEX_WRONG_APPROVAL = "1";
  const x = mk(); await x.start(); await x.startFresh("codex");
  await until(() => !x.view().busy);
  x.enqueue("chat", "STUB_TOOL", "desktop");
  await until(() => x.view().log.some(z => z.text === "Not allowed."));
  ok(!x.view().approvals.length && sent("turn/start").length > 0 && readLog().some(z => z.dir === "in" && z.msg.result?.decision === "decline"), "approval requests for another thread are declined without a captain prompt");
  await x.detach(); x.stop(); delete process.env.STUB_CODEX_WRONG_APPROVAL;
});

await section("retained input follows the first-message handoff", async () => {
  reset(); const m = mk(0); await m.start();
  m.queue.push("chat", "RETAINED-CAPTAIN-INPUT", "desktop");
  m.queue.push("wake", "RETAINED-WAKE", "watcher");
  await m.startFresh("codex"); await until(() => sent("turn/start").length >= 3);
  const starts = sent("turn/start");
  ok(starts[0]?.params.input[0].text.includes("NEWEST-HANDOFF-MARKER"), "fresh handoff is turn one ahead of retained chat and wake");
  ok(starts.slice(1).some(t => t.params.input[0].text === "RETAINED-CAPTAIN-INPUT"), "retained captain input is preserved after the seed");
  await until(() => !m.view().busy); await m.detach();
  m.queue.push("chat", "RETAINED-AFTER-RELEASE", "desktop");
  process.env.STUB_CODEX_NO_FORK = "1"; reset();
  await m.takeover("codex", LIVE, "takeover"); await until(() => sent("turn/start").length >= 2);
  const again = sent("turn/start");
  ok(again[0]?.params.input[0].text.includes("NEWEST-HANDOFF-MARKER") && again[1]?.params.input[0].text === "RETAINED-AFTER-RELEASE", "release then no-fork takeover seeds before retained captain input");
  await m.detach();m.stop();delete process.env.STUB_CODEX_NO_FORK;
});

await section("atomic acquisition and transactional metadata", async () => {
  reset(); const m = mk(); await m.start();
  const original = codex.discover;
  let release!: () => void; const held = new Promise<void>(r => release = r);
  codex.discover = async cwd => { await held; return original(cwd); };
  const first = m.takeover("codex", LIVE, "takeover");
  ok(!(await m.startFresh("codex")).ok && !(await m.attach("codex", LIVE)).ok, "pending discovery reserves acquisition against fresh start and attach");
  release(); await first; codex.discover = original; await m.detach(); m.stop();
  for (const method of ["writeHandoff", "writeDriver"]) {
    const x = mk(); await x.start(); const saved = (x as any)[method];
    let captured: any; const attach = codex.attach;
    codex.attach = async (...args: any[]) => { captured = await (attach as any)(...args); return captured; };
    (x as any)[method] = () => { throw new Error("injected metadata failure"); };
    const result = await x.startFresh("codex");
    ok(!result.ok && result.code === "startupFailed" && x.view().state === "detached" && captured?.pid === null && !x.view().approvals.length, `${method} failure stops host, denies approvals and resets detached state`);
    (x as any)[method] = saved; codex.attach = attach;
    ok((await x.startFresh("codex")).ok, `${method} failure allows clean retry`);
    await x.detach(); x.stop();
  }
});

await section("release stops the pump before ending an active turn", async () => {
  reset(); const m = mk(0); await m.start(); await m.startFresh("codex");
  await until(() => !m.view().busy); reset();
  m.enqueue("chat", "STUB_SLOW", "desktop"); await until(() => m.view().busy && sent("turn/start").length === 1);
  m.enqueue("chat", "QUEUED-AT-RELEASE", "desktop"); m.enqueue("wake", "WAKE-AT-RELEASE", "watcher");
  const active = (m as any).session, detach = active.detach.bind(active);
  active.detach = async () => { const cmd = await detach(); await Bun.sleep(150); return cmd; };
  await m.detach(); await Bun.sleep(100);
  ok(sent("turn/start").length === 1 && readLog().filter(x => x.dir === "start").length === 0, "release during a turn never restarts the host or sends queued inputs");
  ok(m.queue.list().some(x => x.text === "QUEUED-AT-RELEASE") && m.queue.list().some(x => x.kind === "wake"), "release preserves pending chat and wake for the next thread");
  reset(); await m.startFresh("codex"); await until(() => sent("turn/start").length >= 3);
  ok(sent("turn/start")[0]?.params.input[0].text.includes("NEWEST-HANDOFF-MARKER"), "restart after active release sends handoff before preserved input");
  await m.detach(); m.stop();
});

// ---------- 4. Start firstmate on Codex ----------
await section("start firstmate on codex", async () => {
  reset();
  const m = mk(); await m.start();
  const r: any = await (m as any).startFresh("codex");
  ok(r.ok && r.seededFrom === "state/HANDOFF-claude-2026-10-14.md", "Start firstmate on Codex starts a thread", JSON.stringify(r));
  const st = sent("thread/start");
  ok(st.length === 1 && st[0].params.cwd === PROJ && !("model" in st[0].params) && readLog().filter((x) => x.dir === "start").length === 1, "the thread starts in the firstmate repo with the captain's own settings", JSON.stringify(st));
  await until(() => sent("turn/start").length > 0);
  const first = sent("turn/start")[0]?.params;
  ok(first?.threadId === r.id && first.input[0].text.includes("NEWEST-HANDOFF-MARKER: T-310 merge card D-310 waits for the captain.") && /AGENTS\.md/.test(first.input[0].text), "its first message holds the newest handoff file's contents and points at AGENTS.md", first?.input?.[0]?.text?.slice(0, 200));
  const v = m.view() as any;
  ok(v.drive?.path === "fresh" && v.drive?.effort === "low" && v.drive?.model === "gpt-cfg", "the view states the fresh start, model and effort", JSON.stringify(v.drive));
  const drv = JSON.parse(readFileSync(join(m.o.dataDir, "driver.json"), "utf8"));
  ok(drv.holder === "studio" && drv.host === "codex" && drv.sessionId === r.id && drv.path === "fresh", "a fresh start holds the driver lock", JSON.stringify(drv));
  await until(() => !m.view().busy);
  ok((await m.detach()) === `cd ${PROJ} && codex resume ${r.id}`, "its release returns codex resume for the new thread");
  ok(!neverTheLive().length && !sent("thread/fork").length, "a fresh start never touches the live thread");
  const tk = createTakeover({ main: m, fm: { title: () => "" } as any, gh: { state: { prs: [] }, merged: [] } as any, board: { status: () => ({}) } as any, stateDir: ST, pending: () => [], tasks: () => [], crew: () => [] });
  const post = (body: unknown) => tk.handle(new Request("http://x/api/main/start", { method: "POST", body: JSON.stringify(body) }), new URL("http://x/api/main/start"), { kind: "desktop" }, true);
  ok((await post({ host: "codex" }))!.status === 400 && (await post({ host: "claude", confirm: true }))!.status === 400, "the start route needs the captain's confirmation and runs on Codex only");
  m.stop();
});

// ---------- the stub answers like the vendor ----------
{
  const proto = JSON.parse(readFileSync(join(here, "fixture/codex-app-server/protocol.json"), "utf8"));
  ok(/^codex-cli 0\.162\.1/.test(proto.source) && proto.clientRequests.includes("thread/fork") && proto.clientRequests.includes("thread/turns/list"), "the fixture is the installed codex-cli 0.162.1 protocol, which has thread/fork");
  const { validate } = await import("./codex-protocol.mjs");
  const bad = validate({ $ref: "#/definitions/v2/ThreadForkResponse" }, { thread: { id: "x" }, model: "m" });
  ok(bad.length > 0 && bad.some((p: string) => /missing (approvalPolicy|sandbox|cwd)/.test(p)), "the protocol check refuses a made-up shape");
}
reset(); // every message of every section above, both ways, checked by the stub against the recorded protocol
ok(!problems.length, "every message Studio sent and the stub answered fits the installed codex's protocol", JSON.stringify(problems.slice(0, 5)));
// ---------- hygiene ----------
{
  const mine = ["tests/takeover-codex.ts", "tests/takeover-codex-ui.mjs", "tests/codex-protocol.mjs", "tests/stub-host-codex.mjs", "src/host/codex.ts", "src/takeover.ts", "public/takeover.js", "docs/units/takeover-codex.md", "tests/fixture/codex-app-server/protocol.json"]
    .filter((f) => existsSync(join(root, f))).map((f) => readFileSync(join(root, f), "utf8")).join("\n");
  ok(!/\/Users\/[a-z]/.test(mine), "this unit's files carry no machine-specific absolute path");
}
console.log(`\ntakeover-codex: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
