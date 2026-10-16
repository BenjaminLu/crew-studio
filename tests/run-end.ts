import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// How a run ends, and removing runs (docs/units/run-end-and-remove.md), at the engine and
// through the real server's routes:
//   the engine: a close answer ends "closed"; cancel at a card withdraws it, keeps the reason,
//   runs on_cancel; archive and delete only for an ended run; delete keeps the ledger verifiable
//   with one deletion entry;
//   the server (its own data dir, the runs above loaded from their events, plus a code-firstmate
//   stub run on the sandbox repo): the default list hides archived runs; delete needs the typed id
//   and removes the run directory, worktree, branch, cards and captures, never a commit already in
//   main; live runs are refused; no session or a foreign Origin is refused.     bun tests/run-end.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "../src/runtime/checks";
import { freePort, waitUp } from "./boot.mjs";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("run-end");
const root = join(import.meta.dir, "..");

const H = await harness([
  Y({ id: "cardy", name: "cardy", roles: [], hooks: [{ at: "on_cancel", use: "t/hk" }], nodes: [
    { id: "s", kind: "hook", label: "Start", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship it", "zh-TW": "出貨" }, options: [{ id: "ship", label: "Ship" }, { id: "close", label: "Close without merging", hold: true }] }, x: 1, y: 0 },
    { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed", summary: "closed without merging" }, x: 2, y: 1 }],
    edges: [["s", "q"], ["q", "done", "ship"], ["q", "closed", "close"]] }),
  // a slow on_cancel hook (t/slow runs until its 1 s timeout): delete must not race it
  Y({ id: "slowy", name: "slowy", roles: [], hooks: [{ at: "on_cancel", use: "t/slow" }], nodes: [
    { id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship it", "zh-TW": "出貨" }, options: [{ id: "ship", label: "Ship" }] }, x: 0, y: 0 },
    { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["q", "done", "ship"]] }),
  // a node that is still busy after its run is cancelled (its action takes 1.2 s and ignores the cancel)
  Y({ id: "nodey", name: "nodey", roles: [], nodes: [{ id: "b", kind: "hook", label: "Busy", do: "slowact", x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["b", "e"]] }),
  // A held native presentation check: cancellation withdraws the raising owner,
  // while the underlying native promise and node remain owned until settled.
  Y({ id: "raisy", name: "raisy", roles: [], card_checks: ["t/nat"], nodes: [
    { id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship it", "zh-TW": "出貨" }, options: [{ id: "ship", label: "Ship" }] }, x: 0, y: 0 },
    { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["q", "done", "ship"]] }),
  Y({ id: "faily", name: "faily", roles: [], nodes: [{ id: "b", kind: "hook", label: "Boom", do: "boom", x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["b", "e"]] }),
]);
const E = H.engine; const data = H.data;
E.actions.boom = () => { throw new Error("boom: the step failed"); };
E.actions.slowact = async () => { await sleep(1200); return "ok"; };
const openCard = (run: string) => E.cards.list({ run, open: true })[0] ?? null;
const studioLog = () => (existsSync(join(data, "events.jsonl")) ? readFileSync(join(data, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---------- the engine ----------
// 1. close without merging
const closed = E.start({ workflow: "cardy", text: "close me" });
await until(() => !!openCard(closed.id), 8000);
await E.answer(openCard(closed.id)!.id, { choice: "close", by: "captain" });
await until(() => E.get(closed.id)!.status !== "waiting" && E.get(closed.id)!.status !== "running", 8000);
ok(E.get(closed.id)!.status === "succeeded" && E.get(closed.id)!.result === "closed", "a card answered close without merging ends the run with result closed (the UI names it)", JSON.stringify([E.get(closed.id)!.status, E.get(closed.id)!.result]));

// 2. cancel at a card: the card is withdrawn, the reason kept, on_cancel runs
const waiting = E.start({ workflow: "cardy", text: "cancel me" });
await until(() => !!openCard(waiting.id), 8000);
const wcard = openCard(waiting.id)!.id;
const sent0 = H.sent.length;
E.cancel(waiting.id, "captain", "no longer needed");
await until(() => E.ledger(waiting.id).some((e) => e.check === "t/hk"), 8000);
const wr = E.get(waiting.id)!;
ok(wr.status === "cancelled" && /no longer needed/.test(wr.error ?? "") && wr.cancelReason === "no longer needed", "cancel at a card ends the run cancelled with the captain's reason", JSON.stringify([wr.status, wr.error, (wr as any).cancelReason]));
ok(E.cards.get(wcard)!.status === "cancelled" && H.sent.slice(sent0).some(([t, d]: any) => t === "scard" && d.id === wcard && d.status === "cancelled"), "its open card is withdrawn (an scard event says so: it leaves the Inbox and Needs you)");
ok(E.ledger(waiting.id).some((e) => e.check === "t/hk" && e.edge === "hook:on_cancel"), "on_cancel runs");
ok(E.timeline(waiting.id).some((e: any) => e.type === "cancelled" && /no longer needed/.test(e.summary)), "the cancel is an event in the run, with its reason");

// 2b. a run whose on_cancel hooks still run cannot be deleted or archived yet (409 "still finishing"); once they are done,
// delete leaves nothing behind: no write after the deletion entry, no recreated run folder, no unhandled rejection
{ const rejections: string[] = []; const onRej = (e: any) => rejections.push(String(e?.message ?? e)); process.on("unhandledRejection", onRej);
  const slow = E.start({ workflow: "slowy", text: "slow cancel" });
  await until(() => !!openCard(slow.id), 8000);
  E.cancel(slow.id, "captain", null);
  let early = ""; try { E.remove(slow.id, slow.id, "captain"); } catch (e: any) { early = e.message; }
  let earlyA = ""; try { E.archive(slow.id, true, "captain"); } catch (e: any) { earlyA = e.message; }
  ok(/still finishing: .*its on_cancel hooks/.test(early) && /still finishing/.test(earlyA) && existsSync(E.rdir(slow.id)) && E.get(slow.id)?.archived !== true,
    "delete and archive are refused while the run's on_cancel hooks still run (still finishing: …)", JSON.stringify([early, earlyA]));
  await until(() => !E.get(slow.id) || E.busy(slow.id) === null, 8000);
  if (E.get(slow.id)) E.remove(slow.id, slow.id, "captain");
  await sleep(1500);
  const L = new Ledger(data, slow.id).all();
  ok(L.at(-1)?.record === "deletion" && L.some((e) => e.edge === "hook:on_cancel") && !existsSync(E.rdir(slow.id)) && !rejections.length,
    "after the hooks finish, delete leaves nothing behind: the deletion entry stays last, the run folder stays gone, no unhandled rejection", JSON.stringify([L.map((e) => e.record ?? e.check), existsSync(E.rdir(slow.id)), rejections]));
  // the other two holds: a node still in flight after the cancel, and a card still being raised
  const refusedWhile = async (wf: string, ready: (id: string) => boolean, want: RegExp, name: string) => {
    const r = E.start({ workflow: wf, text: name }); await until(() => ready(r.id), 8000);
    E.cancel(r.id, "captain", null);
    let msg = ""; try { E.remove(r.id, r.id, "captain"); } catch (e: any) { msg = e.message; }
    ok(want.test(msg) && existsSync(E.rdir(r.id)) && !!E.get(r.id), name, msg);
    await until(() => !E.get(r.id) || E.busy(r.id) === null, 8000); if (E.get(r.id)) E.remove(r.id, r.id, "captain"); };
  await refusedWhile("nodey", (id) => E.get(id)?.nodes.b?.state === "running", /still finishing: .*node b\b/, "delete is refused while a node of the cancelled run is still in flight (still finishing: node b)");
  let releaseRaise!: () => void, startRaise!: () => void;
  const raisingStarted = new Promise<void>(resolve => { startRaise = resolve; });
  const raisingGate = new Promise<void>(resolve => { releaseRaise = resolve; });
  const nativeBefore = E.natives["test-native"];
  E.natives["test-native"] = async () => { startRaise(); await raisingGate; return { verdict: "pass", findings: [] }; };
  const raisingRun = E.start({ workflow: "raisy", text: "cancel held presentation" });
  await Promise.race([raisingStarted, sleep(8000).then(() => { throw new Error("presentation check did not start"); })]);
  const raisingCard = E.cards.list({ run: raisingRun.id })[0];
  ok(!!raisingCard && /raising card/.test(E.busy(raisingRun.id) ?? ""), "presentation check actually started while its raising owner was held");
  E.cancel(raisingRun.id, "captain", null);
  let removeRaise = "", archiveRaise = "";
  try { E.remove(raisingRun.id, raisingRun.id, "captain"); } catch (e: any) { removeRaise = e.message; }
  try { E.archive(raisingRun.id, true, "captain"); } catch (e: any) { archiveRaise = e.message; }
  ok(/still finishing: .*node q\b/.test(removeRaise) && /still finishing/.test(archiveRaise)
    && !/raising card/.test(E.busy(raisingRun.id) ?? "") && E.cards.get(raisingCard.id)?.status === "cancelled"
    && existsSync(E.rdir(raisingRun.id)) && !E.get(raisingRun.id)?.archived,
    "cancel withdraws the raising card immediately but owned node/native work still blocks archive and delete", JSON.stringify([removeRaise, archiveRaise]));
  const eventsAtCancel = E.events(raisingRun.id).length, ledgerAtCancel = E.ledger(raisingRun.id).length;
  releaseRaise(); await until(() => E.busy(raisingRun.id) === null, 8000);
  ok(E.ledger(raisingRun.id).length === ledgerAtCancel && !E.events(raisingRun.id).slice(eventsAtCancel).some(e => ["card_raised", "check_result", "node_finished"].includes(e.type))
    && !openCard(raisingRun.id), "settling cancelled presentation emits no ordinary late check, node move or replacement card");
  E.remove(raisingRun.id, raisingRun.id, "captain");
  const raiseDeleted = new Ledger(data, raisingRun.id).all(); await sleep(50);
  ok(raiseDeleted.at(-1)?.record === "deletion" && new Ledger(data, raisingRun.id).all().length === raiseDeleted.length
    && !existsSync(E.rdir(raisingRun.id)) && !E.cards.list({ run: raisingRun.id }).length,
    "after presentation settles deletion remains last with no recreated directory or cards");
  E.natives["test-native"] = nativeBefore;
  await sleep(300);
  ok(!rejections.length, "no unhandled rejection from the late work of either run", JSON.stringify(rejections));
  process.off("unhandledRejection", onRej); }

// A native timeout ends the check, not its underlying promise. Its writes still hold the run.
{ const N = await harness([Y({ id: "native-timeout", name: "Native timeout", roles: [], nodes: [
    { id: "n", kind: "check", label: "Native", checks: [{ use: "t/nat" }], x: 0, y: 0 }], edges: [] })]);
  const n = N.engine; n.registry.get("t/nat")!.timeout_s = 0.03;
  let release!: () => void, lateX: any; const gate = new Promise<void>((resolve) => { release = resolve; });
  let settled = false; const rejections: string[] = []; const onRej = (e: any) => rejections.push(String(e)); process.on("unhandledRejection", onRej);
  n.natives["test-native"] = async (input, { x }) => { lateX = x; await gate;
    mkdirSync(n.rdir(input.run), { recursive: true }); writeFileSync(join(n.rdir(input.run), "native-late.txt"), "finished");
    n.record(x, "native-late", {}); settled = true; return { verdict: "pass", findings: [] }; };
  const r = n.start({ workflow: "native-timeout", text: "timeout while native keeps working" });
  await until(() => n.get(r.id)?.status === "failed", 8000);
  await sleep(100); // let the timed-out node finish while the native remains held at the gate
  let archive = "", remove = "";
  try { n.archive(r.id, true, "captain"); } catch (e: any) { archive = e.message; }
  try { n.remove(r.id, r.id, "captain"); } catch (e: any) { remove = e.message; }
  ok(/still finishing: .*native/.test(archive) && /still finishing: .*native/.test(remove) && !!n.get(r.id) && !settled,
    "a timed-out native still holds archive and delete until its underlying promise settles", JSON.stringify([archive, remove, n.busy(r.id)]));
  release(); await until(() => settled && n.busy(r.id) === null, 8000);
  if (n.get(r.id)) n.remove(r.id, r.id, "captain");
  const before = new Ledger(N.data, r.id).all();
  n.record(lateX, "stale-native", {}); // stale holders cannot append after the deletion entry either
  await sleep(100); const after = new Ledger(N.data, r.id).all();
  ok(before.at(-1)?.record === "deletion" && after.length === before.length && after.at(-1)?.record === "deletion"
    && !existsSync(n.rdir(r.id)) && !rejections.length,
    "native completion precedes deletion; stale record is inert, deletion stays last and no run folder returns", JSON.stringify([after.map((e) => e.record), existsSync(n.rdir(r.id)), rejections]));
  process.off("unhandledRejection", onRej); N.stop(); }

// 2c. a domain clean-up (onDelete) that throws leaves the run intact: still listed, still writable, the error goes back
{ const r = E.start({ workflow: "faily", text: "ondelete throws" }); await until(() => E.get(r.id)!.status === "failed", 8000);
  const was = E.onDelete; E.onDelete = () => { throw new Error("the pack's clean-up failed"); };
  let msg = ""; try { E.remove(r.id, r.id, "captain"); } catch (e: any) { msg = e.message; }
  E.onDelete = was;
  E.archive(r.id, true, "captain");
  ok(/clean-up failed/.test(msg) && !!E.get(r.id) && existsSync(E.rdir(r.id)) && E.events(r.id).some((e) => e.type === "archived") && E.get(r.id)!.archived === true,
    "an onDelete that throws returns its error and leaves the run intact: later writes still land (archive records its event)", JSON.stringify([msg, E.events(r.id).map((e) => e.type).slice(-3)])); }

// a failed run
const failed = E.start({ workflow: "faily", text: "fail" });
await until(() => E.get(failed.id)!.status === "failed", 8000);
ok(E.get(failed.id)!.status === "failed", "a step that throws fails its run (the fixture's failed run)");

// a live run (waiting at its card) for the refusals
const live = E.start({ workflow: "cardy", text: "keep me" });
await until(() => !!openCard(live.id), 8000);

// 3. archive: only an ended run; recorded as an event; folded back on reload
let refused = ""; try { E.archive(live.id, true, "captain"); } catch (e: any) { refused = e.message; }
ok(/only an ended run/.test(refused), "the engine refuses to archive a live run", refused);
E.archive(failed.id, true, "captain");
ok(E.get(failed.id)!.archived === true && E.events(failed.id).some((e) => e.type === "archived"), "archiving a failed run records an event and marks it archived");
ok(studioLog().some((e) => e.type === "run_archived" && e.task === failed.id), "the archive is in Studio's event log");
E.archive(failed.id, false, "captain");
ok(E.get(failed.id)!.archived === false && E.events(failed.id).filter((e) => e.type === "archived").length === 1 && E.events(failed.id).filter((e) => e.type === "unarchived").length === 1, "unarchive restores it, recorded as its own event (unarchived), not a second archived");
E.archive(failed.id, true, "captain");

// 4. delete (engine): the typed id; the ledger keeps its signed entries and gains a deletion entry
mkdirSync(join(E.rdir(closed.id), "captures", "abc1234", "after"), { recursive: true }); writeFileSync(join(E.rdir(closed.id), "captures", "abc1234", "after", "index.png"), "png");
const ccard = E.cards.list({ run: closed.id })[0]?.id;
const before = new Ledger(data, closed.id).all().length;
refused = ""; try { E.remove(closed.id, "R-999", "captain"); } catch (e: any) { refused = e.message; }
ok(/type the run id/i.test(refused) && existsSync(E.rdir(closed.id)), "a wrong typed id is refused and nothing is removed", refused);
refused = ""; try { E.remove(live.id, live.id, "captain"); } catch (e: any) { refused = e.message; }
ok(/only an ended run/.test(refused) && !!E.get(live.id), "the engine refuses to delete a live run", refused);
E.remove(closed.id, closed.id, "captain");
const led = new Ledger(data, closed.id);
ok(!existsSync(E.rdir(closed.id)) && !E.get(closed.id) && !!ccard && !E.cards.get(ccard), "delete removes the run directory (its captures with it) and its cards");
ok(led.verify().length === 0 && led.all().length === before + 1 && led.all().at(-1)!.record === "deletion" && led.all().at(-1)!.actor === "captain", "the ledger verifies afterwards and has one deletion entry (who, when, run id)", JSON.stringify(led.all().at(-1)));
ok(studioLog().some((e) => e.type === "run_deleted" && e.task === closed.id), "the delete is in Studio's event log");
H.stop();

// ---------- the route: 409 "still finishing" (the runtime's own handler, in process, over its own data) ----------
{ const H3 = await harness([Y({ id: "nodey", name: "nodey", roles: [], nodes: [{ id: "b", kind: "hook", label: "Busy", do: "slowact", x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["b", "e"]] })]); H3.stop();
  const { createRuntime } = await import("../src/runtime");
  const { stubProvider } = await import("../src/providers/stub");
  const { StudioLog } = await import("../src/rawlog");
  const rt = createRuntime({ dataDir: H3.data, agents: H3.agents, provider: () => ({ ...stubProvider(), id: "stub", model: "no model" }) as any, defaultProvider: () => ({ provider: "stub", model: null }),
    log: new StudioLog(join(H3.data, "events.jsonl")), send: () => {}, fmRoot: join(H3.data, "..", "no-fm"), studioUrl: () => "",
    install: [(e) => { e.actions.slowact = async () => { await sleep(1200); return "ok"; }; }] } as any);
  const post = async (path: string, body: any) => { const url = new URL(`http://studio.test${path}`); const res = await rt.handle(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), url, { kind: "captain" }, true);
    return { status: res!.status, body: await res!.json() }; };
  const st = await post("/api/wruns", { workflow: "nodey", text: "busy at cancel" }); const rid = st.body.id;
  await until(() => rt.engine.get(rid)?.nodes.b?.state === "running", 8000);
  const c = await post(`/api/wruns/${rid}/cancel`, { reason: null });
  const d = await post(`/api/wruns/${rid}/delete`, { confirm: rid });
  ok(c.status === 200 && d.status === 409 && /still finishing: .*node b/.test(d.body.error ?? "") && existsSync(rt.engine.rdir(rid)), "the route answers 409 \"still finishing\" for a delete while the run's work is in flight", JSON.stringify([st.status, c.status, d]));
  await until(() => rt.engine.busy(rid) === null, 8000); }

// ---------- the real server over the same data, plus a code-firstmate run ----------
const port = await freePort(); const base = `http://127.0.0.1:${port}`; const tok = "run-end-session";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const fm = join(data, "..", `fm-${port}`, "state"); mkdirSync(join(fm, "pending"), { recursive: true });
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: tok, CREW_FM_STATE: fm, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(data, "..", `home-${port}`), CREW_MAIN_PROJECT: join(data, "..", `proj-${port}`) } });
let appLog = ""; app.stdout!.on("data", (d) => (appLog += d)); app.stderr!.on("data", (d) => (appLog += d));
try {
  await waitUp(base, app);
  const call = async (method: string, p: string, body?: any, h: Record<string, string> = { "x-crew-session": tok }) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
  };
  const ids = async (q = "") => ((await call("GET", `/api/wruns${q}`)).body.runs || []).map((r: any) => r.id);
  // 3. the lists
  const def = await ids(), all = await ids("?archived=1");
  ok(!def.includes(failed.id) && all.includes(failed.id), "the default list hides an archived run; ?archived=1 shows it", JSON.stringify({ def, all }));
  const row = ((await call("GET", "/api/wruns?archived=1")).body.runs || []).find((r: any) => r.id === failed.id);
  ok(row?.archived === true, "a listed run says it is archived");
  ok((await call("POST", `/api/wruns/${failed.id}/archive`, { archived: false })).status === 200 && (await ids()).includes(failed.id), "unarchive through the route brings it back to the default list");
  // 5. refusals: a live run; no session; a foreign Origin
  const la = await call("POST", `/api/wruns/${live.id}/archive`, { archived: true }), ld = await call("POST", `/api/wruns/${live.id}/delete`, { confirm: live.id });
  ok(la.status === 409 && ld.status === 409 && (await ids()).includes(live.id), "the server refuses archive and delete for a live run", JSON.stringify([la, ld]));
  const ns = await call("POST", `/api/wruns/${failed.id}/delete`, { confirm: failed.id }, {});
  const fo = await call("POST", `/api/wruns/${failed.id}/archive`, { archived: true }, { "x-crew-session": tok, origin: "https://evil.example" });
  ok(ns.status === 403 && fo.status === 403 && (await ids()).includes(failed.id) && !(await call("GET", "/api/wruns?archived=1")).body.runs.find((r: any) => r.id === failed.id)?.archived, "no session, or a foreign Origin: both refused, nothing changed", JSON.stringify([ns.status, fo.status]));
  const wrong = await call("POST", `/api/wruns/${failed.id}/delete`, { confirm: "R-0" });
  ok(wrong.status === 400 && /type the run id/i.test(wrong.body.error ?? "") && (await ids()).includes(failed.id), "a wrong typed id is refused by the route", JSON.stringify(wrong));

  // 4 + 6. a code run on the sandbox repo: a worktree and a branch; cancel, merge its commit into main, delete.
  // code-firstmate itself only starts for a registered project with an approved staffing configuration
  // (src/domain/staffing.ts installStaffingGuard, tests/firstmate-staffing.ts); the clean-up under test is the
  // code domain's (src/domain/code.ts onDelete), so the run uses the same graph under its own id, which the
  // staffing guard does not cover, and runs on the stub provider over the built-in sandbox project.
  { const wdir = join(data, "workflows"), src = join(wdir, "code-firstmate");
    const latest = readdirSync(src).filter((f) => /^v\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5))).at(-1)!;
    const def = JSON.parse(readFileSync(join(src, latest), "utf8"));
    mkdirSync(join(wdir, "code-run-end"), { recursive: true });
    writeFileSync(join(wdir, "code-run-end", "v1.json"), JSON.stringify({ ...def, id: "code-run-end", name: "Code (run-end fixture)", version: 1, parent: null, by: "run-end test", note: "a copy of code-firstmate", diff: null, seed: undefined })); }
  const text = "Add a percent function\nSTUB_FILE src/percent.ts :: export const percent = (a: number, p: number) => Math.round((a * p) / 100);\\n";
  const st = await call("POST", "/api/wruns", { text, workflow: "code-run-end" }); const rid = st.body.id;
  let det: any = null; for (let i = 0; i < 240; i++) { det = (await call("GET", `/api/wruns/${rid}`)).body; if (det?.ctx?.branch && det.cards?.some((c: any) => c.status === "open")) break; await sleep(500); }
  const repo = det?.ctx?.repo, branch = det?.ctx?.branch, mainBranch = det?.ctx?.base;
  ok(!!repo && !!branch && existsSync(det.ctx.worktree), "the code run has its worktree and branch in the sandbox repo", JSON.stringify({ repo, branch, wt: det?.ctx?.worktree }));
  const git = (...a: string[]) => { const r = Bun.spawnSync(["git", "-C", repo, ...a]); return { ok: r.exitCode === 0, out: r.stdout.toString().trim() }; };
  // a commit on the run's branch, then merged into main (as a merge does)
  const tip0 = git("rev-parse", branch).out;
  const tree = git("rev-parse", `${tip0}^{tree}`).out;
  const commit = Bun.spawnSync(["git", "-C", repo, "commit-tree", tree, "-p", tip0, "-m", "R merged work"], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).stdout.toString().trim();
  git("update-ref", `refs/heads/${branch}`, commit); git("update-ref", `refs/heads/${mainBranch}`, commit);
  ok((await call("POST", `/api/wruns/${rid}/cancel`, { reason: "testing delete" })).status === 200, "the code run is cancelled");
  writeFileSync(join(data, "runs", rid, "probe.txt"), "x");
  const cardsBefore = readdirSync(join(data, "cards")).filter((f) => JSON.parse(readFileSync(join(data, "cards", f), "utf8")).run === rid).length;
  const del = await call("POST", `/api/wruns/${rid}/delete`, { confirm: rid });
  const cardsAfter = readdirSync(join(data, "cards")).filter((f) => JSON.parse(readFileSync(join(data, "cards", f), "utf8")).run === rid).length;
  ok(del.status === 200 && !existsSync(join(data, "runs", rid)) && !(await ids("?archived=1")).includes(rid) && cardsBefore > 0 && cardsAfter === 0, "delete with the typed id removes the run directory and its cards", JSON.stringify({ del, cardsBefore, cardsAfter }));
  ok(!git("rev-parse", "--verify", `refs/heads/${branch}`).ok && !existsSync(det.ctx.worktree) && !git("worktree", "list").out.includes(det.ctx.worktree), "delete removes the run's worktree and branch in the sandbox repo");
  ok(git("cat-file", "-e", commit).ok && git("merge-base", "--is-ancestor", commit, mainBranch).ok, "delete never removes a commit already merged into the sandbox repo's main");
  const dl = new Ledger(data, rid);
  ok(dl.verify().length === 0 && dl.all().at(-1)?.record === "deletion", "the deleted run's ledger verifies and ends with its deletion entry");
} finally { app.kill(); }
if (process.env.RUN_END_LOG) console.log(appLog.slice(-3000));
end();
