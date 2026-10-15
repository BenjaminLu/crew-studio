// Takeover tests: fork-only takeover of the firstmate session (the original id is
// never resumed), same model and permission mode, rehearsal env, handoff notes,
// release commands, turns started by the session's own hook, wakes (shown, held
// in a rehearsal, dropped when firstmate's hook delivered them, sent after the
// grace otherwise), questions through the permission bridge, the door check.
//   bun tests/takeover.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = import.meta.dir, root = join(here, "..");
const TMP = mkdtempSync(join(tmpdir(), "crew-takeover-"));
process.env.HOME = TMP;
const { claudeHost, encodeCwd } = await import("../src/host/claude");
const { MainSession } = await import("../src/host/main");
const TK: any = await import("../src/takeover").catch(() => ({})); // missing before the takeover unit: its tests then fail one by one
const { needsDoor, doorInput, dispatchText } = TK;

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await Bun.sleep(25); return f(); };

const PROJ = join(TMP, "fm"); const ST = join(PROJ, "state"); mkdirSync(join(ST, "session/acknowledged"), { recursive: true });
writeFileSync(join(ST, "session/wake.jsonl"), "");
const PROJECTS = join(TMP, ".claude/projects"), PDIR = join(PROJECTS, encodeCwd(PROJ)); mkdirSync(PDIR, { recursive: true });
const ORIG = "orig-session-1";
const origFile = join(PDIR, `${ORIG}.jsonl`);
writeFileSync(origFile, [
  { type: "user", isSidechain: false, cwd: PROJ, sessionId: ORIG, permissionMode: "auto", message: { role: "user", content: "firstmate main" } },
  { type: "assistant", isSidechain: false, cwd: PROJ, sessionId: ORIG, message: { role: "assistant", model: "model-x", content: [{ type: "text", text: "hi" }] } },
].map((o) => JSON.stringify(o)).join("\n") + "\n");
const ARGV = join(TMP, "argv.jsonl");
process.env.STUB_ARGV_FILE = ARGV;
const DATA = join(TMP, "data"); mkdirSync(DATA);
let procs: { pid: number; command: string; cwd: string | null }[] = [{ pid: 999001, command: `claude --resume ${ORIG}`, cwd: PROJ }];
const probe = { list: () => procs };
const claude = claudeHost(join(here, "stub-host-claude.mjs"), PROJECTS);
const mk = (grace = 300) => new MainSession({ dataDir: DATA, projectDir: PROJ, stateDir: ST, probe, hosts: { claude, codex: claude } as any, pollMs: 50, wakeGraceMs: grace,
  permissionMcp: (b) => ({ command: [process.execPath, join(root, "src/permission-mcp.ts")], env: { CREW_PERM_SOCKET: b.socket, CREW_PERM_TOKEN: b.token } }) });

const disc = await claude.discover(PROJ);
ok(disc[0]?.model === "model-x" && disc[0]?.permissionMode === "auto", "discover reads the session's model and permission mode", JSON.stringify(disc[0]));

const section = async (name: string, f: () => Promise<void>) => { try { await f(); } catch (e: any) { fail++; console.log(`  FAIL  ${name}: ${String(e?.message ?? e).split("\n")[0]}`); } };
await section("rehearsal and release", async () => {
// ---------- rehearsal: a copy, hooks standing down, wakes held ----------
const m = mk(); await m.start();
const origBefore = readFileSync(origFile, "utf8");
const r = await m.takeover("claude", ORIG, "rehearsal");
ok(r.ok, "takeover is allowed while the terminal holds the original (it forks)", JSON.stringify(r));
ok(m.view().origin?.terminal && /names this session/.test(m.view().origin!.terminal!), "the view says the terminal still looks open");
await Bun.sleep(300);
const a0 = readFileSync(ARGV, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
ok(a0.argv.includes("--fork-session") && a0.argv[a0.argv.indexOf("--model") + 1] === "model-x" && a0.argv[a0.argv.indexOf("--permission-mode") + 1] === "auto"
  && a0.argv.includes("--permission-prompt-tool") && !a0.argv.includes("--dangerously-skip-permissions"), "the CLI forks with the same model and permission mode, prompts to Studio", JSON.stringify(a0.argv));
ok(a0.FM_IN_ROUND === "1", "a rehearsal runs with FM_IN_ROUND=1 so firstmate's hooks stand down");
m.enqueue("chat", "T-307 status, one line", "desktop");
await until(() => m.view().log.some((x) => x.kind === "firstmate"));
ok(m.view().sessionId === `${ORIG}-copy`, "Studio follows the copy's new id", m.view().sessionId ?? "");
ok(readFileSync(origFile, "utf8") === origBefore, "the original transcript is never written");
const drv = JSON.parse(readFileSync(join(DATA, "driver.json"), "utf8"));
ok(drv.holder === "studio" && drv.forkedFrom === ORIG && drv.sessionId === `${ORIG}-copy` && drv.mode === "rehearsal", "the driver lock names the copy, the original and the mode", JSON.stringify(drv));
const notes = readdirSync(join(DATA, "handoff"));
ok(notes.length === 1 && /The copy Studio drives is orig-session-1-copy/.test(readFileSync(join(DATA, "handoff", notes[0]), "utf8")), "a handoff note is written in data/handoff and names the copy");
// a synthetic wake in this temp state reaches the queue and is held
appendFileSync(join(ST, "session/wake.jsonl"), JSON.stringify({ id: "worker-x-t1-r1", reason: "finished", line: "worker: T-1 finished", woken: 1000 }) + "\n");
await until(() => m.view().queue.some((q) => q.kind === "wake"));
ok(m.view().queue.some((q) => q.kind === "wake" && q.lines!.includes("worker: T-1 finished")) && m.view().log.some((x) => x.kind === "system" && x.text === "wake: worker: T-1 finished"),
  "a synthetic wake reaches the queue and shows in the stream as a system line");
appendFileSync(join(ST, "session/wake.jsonl"), JSON.stringify({ id: "worker-x-t1-r1", reason: "finished", line: "worker: T-1 finished", woken: 1000 }) + "\n");
await Bun.sleep(700);
ok(m.view().queue.filter((q) => q.kind === "wake").length === 1 && m.view().log.filter((x) => x.text === "wake: worker: T-1 finished").length === 1, "the same wake twice is one wake");
ok(!m.view().log.some((x) => x.kind === "wake"), "a rehearsal never sends a wake");
writeFileSync(join(ST, "session/acknowledged/worker-x-t1-r1.json"), JSON.stringify({ id: "worker-x-t1-r1", acknowledged: 1000 }));
await until(() => !m.view().queue.length);
ok(!m.view().queue.length && m.view().log.some((x) => /delivered by firstmate's own hook: worker: T-1 finished/.test(x.text)), "a wake firstmate's hook delivered leaves the queue");
// the original written again: noted
appendFileSync(origFile, JSON.stringify({ type: "user", message: { content: "terminal" } }) + "\n");
const t = Date.now() / 1000 + 5; utimesSync(origFile, t, t);
await until(() => (m.view().origin?.originWrites ?? 0) > 0);
ok(m.view().origin!.originWrites === 1 && m.view().state === "attached", "a write to the original is noted, and the copy keeps running");
// questions through the bridge
m.enqueue("chat", "STUB_ASK", "desktop");
await until(() => m.view().approvals.some((a) => a.tool === "AskUserQuestion"));
const q = m.view().approvals.find((a) => a.tool === "AskUserQuestion")!;
m.bridge.answer(q.id, true, undefined, { ...(q.input as any), answers: { "Which shard budget?": "540s" } });
await until(() => m.view().log.some((x) => x.kind === "firstmate" && x.text.startsWith("answered")));
ok(m.view().log.some((x) => x.text === 'answered: {"Which shard budget?":"540s"}'), "a question the session asks is answered from Studio");
// release
const cmd = await m.detach();
ok(cmd === `cd ${PROJ} && claude --resume ${ORIG}-copy`, "release returns the copy's resume command", cmd ?? "");
const note = readFileSync(join(DATA, "handoff", notes[0]), "utf8");
ok(/## Released/.test(note) && note.includes(`claude --resume ${ORIG}\``), "the handoff note gets the release and the rollback to the original");
const drv2 = JSON.parse(readFileSync(join(DATA, "driver.json"), "utf8"));
ok(drv2.holder === "terminal" && drv2.forkedFrom === ORIG, "the lock goes back to the terminal");
m.stop();
});

await section("takeover mode: hook turns and wakes", async () => {
// ---------- takeover: hook turns followed, unacked wakes sent after the grace ----------
const m2 = mk(400); await m2.start();
ok((await m2.takeover("claude", ORIG, "takeover")).ok, "takeover mode starts");
await Bun.sleep(200);
ok(readFileSync(ARGV, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1).FM_IN_ROUND === null, "a real takeover keeps firstmate's hooks (no FM_IN_ROUND)");
m2.enqueue("chat", "STUB_LATER", "desktop");
await until(() => m2.view().log.some((x) => x.kind === "firstmate" && x.text === "woken by the hook"));
ok(m2.view().log.some((x) => /a turn Studio did not send started/.test(x.text)) && m2.view().log.some((x) => x.text === "woken by the hook"), "a turn the session's own hook started is followed and shown");
await until(() => !m2.view().busy);
appendFileSync(join(ST, "session/wake.jsonl"), JSON.stringify({ id: "board-D-9", reason: "answered", decision: { chosen: "A" }, woken: 2000 }) + "\n");
await until(() => m2.view().queue.some((q) => q.kind === "wake"), 3000);
ok(m2.view().queue.some((q) => q.kind === "wake"), "a new wake waits in the queue for the hook's grace");
await until(() => m2.view().log.some((x) => x.kind === "wake"), 5000);
ok(m2.view().log.some((x) => x.kind === "wake" && x.text.includes("card: board-D-9 answered A")), "a wake the hook did not deliver is sent by Studio after the grace");
await m2.detach(); m2.stop();
});

await section("takeover mode: a later wake keeps its own grace", async () => {
  const GRACE = 1500;
  const m3 = mk(GRACE); await m3.start();
  ok((await m3.takeover("claude", ORIG, "takeover")).ok, "takeover for the grace test");
  m3.enqueue("chat", "hello", "desktop");
  await until(() => m3.view().log.some((x) => x.kind === "firstmate") && !m3.view().busy);
  const wl = join(ST, "session/wake.jsonl");
  appendFileSync(wl, JSON.stringify({ id: "grace-a", reason: "x", line: "grace: A", woken: 3000 }) + "\n");
  await until(() => m3.view().queue.some((q) => q.kind === "wake"));
  await Bun.sleep(900);
  appendFileSync(wl, JSON.stringify({ id: "grace-b", reason: "x", line: "grace: B", woken: 3001 }) + "\n");
  await until(() => m3.view().log.some((x) => x.text === "wake: grace: B"));
  const tB = m3.view().log.find((x) => x.text === "wake: grace: B")!.at;
  await until(() => m3.view().log.some((x) => x.kind === "wake"), 6000);
  await until(() => !m3.view().busy);
  await Bun.sleep(GRACE);
  const sent = m3.view().log.filter((x) => x.kind === "wake");
  const first = sent[0];
  ok(first && first.at >= tB + GRACE - 60, "a wake folded into a waiting one is not sent before its own grace", JSON.stringify({ sentAt: first?.at, tB }));
  const count = (l: string) => sent.reduce((n, x) => n + x.text.split("\n").filter((y) => y === l).length, 0);
  ok(count("grace: A") === 1 && count("grace: B") === 1, "each folded wake is sent exactly once", JSON.stringify(sent.map((x) => x.text)));
  await m3.detach(); m3.stop();
});

await section("cards and dispatch", async () => {
// ---------- cards: the door confirmation, dispatch text ----------
const card: any = { id: "D-1", kind: "merge", details: { en: { door: { kind: "one-way" }, intent: [{ text: "a" }, { text: "b" }], check: { q: "?", options: ["x", "y"] } } } };
ok(needsDoor(card, "A") && !needsDoor(card, "B") && !needsDoor(card, "A", [{ ok: false }]), "a one-way merge answer needs the door confirmation; hold and send-back do not");
ok(doorInput({ reviewed_intents: [1, 2], check_answer: 1, locale: "zh-TW" })?.locale === "zh-TW" && doorInput({ reviewed_intents: [], check_answer: 0 }) === null, "the door input is checked before it reaches the board");
ok(/raise the dispatch card through firstmate's normal scripts/.test(dispatchText("x")) && /Do not dispatch before/.test(dispatchText("x")), "dispatch from chat asks firstmate for a card, not a dispatch");
});
await section("live crew and card forwarding", async () => {
// ---------- live crew and card forwarding (the API module, with a temp copy of the fixture state) ----------
  const { cpSync } = await import("node:fs");
  const { FmState } = await import("../src/fm");
  const { createTakeover } = await import("../src/takeover");
  const st = join(TMP, "fixture-state"); cpSync(join(here, "fixture/state"), st, { recursive: true });
  const t = Date.now() / 1000; for (const r of readdirSync(join(st, "runs"))) utimesSync(join(st, "runs", r), t, t);
  const worker = readdirSync(join(st, "runs")).find((r) => r.startsWith("worker-"))!;
  const attempt = readdirSync(join(st, "runs", worker)).find((x) => x.startsWith("claude-"))!;
  writeFileSync(join(st, "runs", worker, "last-result.json"), JSON.stringify({ status: "completed", exit_code: 0 }));
  writeFileSync(join(st, "runs", worker, attempt, "final.txt"), "I fixed the shard split.\n");
  const fm = new FmState(st); fm.pollEvents();
  const sent: any[] = [];
  const board: any = { status: () => ({ writable: true }), checkDoor: async (b: any) => { sent.push(b); return { status: 200, body: { ok: b.check_answer === 1, id: b.id } }; } };
  const pend: any[] = [{ id: "D-77", kind: "merge", task: null, details: { en: { door: { kind: "one-way" }, intent: [{ text: "a" }, { text: "b" }], check: { q: "?", options: ["x", "y"] } } } }];
  const gh: any = { state: { prs: [] }, merged: [] };
  const tk = createTakeover({ main: mk(), fm, gh, board, stateDir: st, pending: () => pend, tasks: () => fm.taskList(new Set(), [], 36500), crew: () => fm.crew(4) });
  const live = tk.crewLive();
  const w = live.find((c: any) => c.actor === worker)!;
  ok(w && w.role === "worker" && w.task && w.vendor && typeof w.elapsedMs === "number" && w.phase === "finished" && w.report === true && "ci" in w && "pr" in w && "title" in w,
    "the live crew lists each round with task, title, role, vendor, phase, elapsed, PR, CI and its report", JSON.stringify(w));
  const call = (path: string, method = "GET", body?: unknown) => tk.handle(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined }), new URL(`http://x${path}`), { kind: "desktop" }, method !== "GET");
  const rep = await (await call(`/api/crew/report/${worker}`))!.json();
  ok(rep.text === "I fixed the shard split.\n", "a finished round's final report is served");
  // a finished round whose old pid now belongs to another process is not live
  writeFileSync(join(st, "runs", worker, "process.json"), JSON.stringify({ pid: process.pid }));
  const t2 = Date.now() / 1000 + 5; utimesSync(join(st, "runs", worker, "last-result.json"), t2, t2);
  ok(fm.crew(0).find((c: any) => c.actor === worker)?.alive === false, "a round that wrote its result is not live even if its old pid is reused");
  ok((await call(`/api/crew/report/..%2F..%2Fetc`))!.status === 404 && (await import("../src/fm")).crewReport(st, "..") === null, "a report path outside the runs is refused");
  const bad = await call("/api/answer/check-door", "POST", { id: "D-77", reviewed_intents: [], check_answer: 1 });
  ok(bad!.status === 400 && !sent.length, "a door check without every intent reviewed never reaches the board");
  const partial = await call("/api/answer/check-door", "POST", { id: "D-77", reviewed_intents: [1], check_answer: 1 });
  ok(partial!.status === 400 && !sent.length, "a door check with only some of the card's intents never reaches the board");
  const dup = await call("/api/answer/check-door", "POST", { id: "D-77", reviewed_intents: [1, 2, 2], check_answer: 1 });
  const dup2 = await call("/api/answer/check-door", "POST", { id: "D-77", reviewed_intents: [1, 1], check_answer: 1 });
  const extra = await call("/api/answer/check-door", "POST", { id: "D-77", reviewed_intents: [1, 2, 3], check_answer: 1 });
  ok(dup!.status === 400 && dup2!.status === 400 && extra!.status === 400 && !sent.length, "a door check with a repeated or unknown intent never reaches the board");
  ok(TK.doorComplete?.(pend[0], { reviewed_intents: [2, 1] }) === true && TK.doorComplete?.(pend[0], { reviewed_intents: [1] }) === false, "door completeness: every intent of the card, each once");
  const good = await (await call("/api/answer/check-door", "POST", { id: "D-77", reviewed_intents: [1, 2], check_answer: 1, locale: "zh-TW" }))!.json();
  ok(good.ok === true && sent[0]?.id === "D-77" && sent[0]?.locale === "zh-TW", "the door check is forwarded to the board's own check-door", JSON.stringify(sent));
  ok((await call("/api/main/takeover", "POST", { id: ORIG, mode: "takeover" }))!.status === 400, "a takeover needs the captain's explicit confirmation");
});
// ---------- hygiene: no stray debug writer, no machine-specific path in this unit's files ----------
{
  const { readFileSync: rf, readdirSync: rd } = await import("node:fs");
  const host = rd(join(root, "src/host")).filter((f) => f.endsWith(".ts")).map((f) => rf(join(root, "src/host", f), "utf8")).join("\n");
  ok(!/CREW_HOST_TRACE|\brequire\(/.test(host), "the host has no undocumented trace writer and no require() in ES modules");
  const mine = ["tests/takeover.ts", "tests/takeover-ui.mjs", "docs/units/takeover.md", "src/takeover.ts", "public/takeover.js"].map((f) => rf(join(root, f), "utf8")).join("\n");
  ok(!/\/Users\/[a-z]/.test(mine), "this unit's files carry no machine-specific absolute path");
}
console.log(`\ntakeover: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
