// Task and Round (docs/units/task-round.md): a Task is one piece of work going through a workflow
// (stored as a run); a Round is one launch of an agent or a check inside it, or a card answered on
// the way. Rounds come from the run's steps (no stored-data migration). /api/tasks serves Tasks and
// Rounds; /api/wruns keeps answering as an alias.          bun tests/task-round.ts
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTasksApi, taskAlias } from "../src/tasks-api";
import { roundsOf, taskOf } from "../src/task-round";
import { freePort, waitUp } from "./boot.mjs";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("task-round");
const root = join(import.meta.dir, "..");
process.env.CREW_SESSION_TOKEN ??= "test-session";

const roles = [{ id: "w", label: "Builder", skill: "x" }];
const H = await harness([Y({ id: "tr", name: "tr", roles, nodes: [
  { id: "a", kind: "agent", label: "Build", role: "w", mode: "test", x: 0, y: 0 },
  { id: "c", kind: "check", label: "Tests", checks: [{ use: "t/ok" }], x: 1, y: 0 },
  { id: "k", kind: "card", label: "Ship card", card: { title: "Ship it?", options: [{ id: "go", label: "Go" }] }, x: 2, y: 0 },
  { id: "e", kind: "hook", label: "End", x: 3, y: 0 }], edges: [["a", "c"], ["c", "k", "pass"], ["k", "e", "go"]] })]);
const E = H.engine as any;
const api = createTasksApi({ list: () => E.list(), get: (id) => E.get(id), openCards: () => E.cards.list({ open: true }), runView: async (id) => ({ id, events: E.timeline(id) }) });
const call = async (p: string) => { const r = await api.handle(new URL(`http://x${p}`), false); return r ? { status: r.status, body: await r.json() } : null; };

const r = E.start({ workflow: "tr", text: "make it" });
await until(() => E.cards.list({ run: r.id, open: true }).length > 0, 15000);
{ const t = taskOf(E.get(r.id), E.cards.list({ open: true }));
  ok(t.status === "needs-you" && t.node === "k", "a Task waiting on its card needs the captain, on the card's node", `${t.status} ${t.node}`);
  const lst = await call("/api/tasks");
  ok(lst?.status === 200 && lst.body.tasks.some((x: any) => x.id === r.id && x.status === "needs-you" && x.roundCount === 3 && !("rounds" in x)), "GET /api/tasks lists the Task with its status and Round count", JSON.stringify(lst?.body.tasks)); }
await E.answer(E.cards.list({ run: r.id, open: true })[0].id, { choice: "go", by: "captain" });
await until(() => E.get(r.id).status === "succeeded", 15000);

// ---- done line 5, the API half: a Task's Rounds with node, actor, number, times, outcome, cost and transcript ----
const rounds = roundsOf(E.get(r.id));
ok(rounds.map((x) => x.node).join(",") === "a,c,k", "the Rounds are the agent, the check and the card, in order (hooks are not Rounds)", rounds.map((x) => x.node).join(","));
const [ra, rc, rk] = rounds;
ok(ra?.actor.kind === "agent" && ra.actor.role === "w" && ra.actor.label === "Build" && !!ra.actor.provider, "an agent Round names its node, role and provider", JSON.stringify(ra?.actor));
ok(rc?.actor.kind === "check" && /t\/ok/.test(rc.actor.name ?? ""), "a check Round names its checks", JSON.stringify(rc?.actor));
ok(rk?.actor.kind === "card" && rk.outcome === "chosen" && rk.verdict === "go", "a card Round is the captain's choice", JSON.stringify(rk));
ok(rounds.length === 3 && rounds.every((x) => x.number === 1 && x.attempt === 1 && !!x.startedAt && !!x.endedAt && x.endedAt >= x.startedAt!), "each Round has its number, attempt, start and end", JSON.stringify(rounds.map((x) => [x.number, x.attempt, x.startedAt, x.endedAt])));
ok(ra?.outcome === "passed" && rc?.outcome === "passed", "each Round has its outcome", `${ra?.outcome} ${rc?.outcome}`);
ok((ra?.cost?.inTokens ?? 0) > 0 && (ra?.cost?.outTokens ?? 0) > 0 && ra?.cost?.seconds != null, "an agent Round carries its cost (tokens, seconds)", JSON.stringify(ra?.cost));
ok(ra?.transcript === `#/runs/node/${r.id}/a/1` && rc?.transcript === null && rk?.transcript === null, "an agent Round links to its transcript; a check or a card has none", `${ra?.transcript} ${rc?.transcript}`);
{ const one = await call(`/api/tasks/${r.id}`);
  ok(one?.status === 200 && one.body.task?.id === r.id && one.body.task.status === "done" && one.body.rounds?.length === 3 && Array.isArray(one.body.events), "GET /api/tasks/<id> is the run view plus the Task and its Rounds", JSON.stringify(one?.body.task));
  const rr = await call(`/api/tasks/${r.id}/rounds`);
  ok(rr?.status === 200 && rr.body.task === r.id && JSON.stringify(rr.body.rounds) === JSON.stringify(rounds), "GET /api/tasks/<id>/rounds is its Rounds", String(JSON.stringify(rr?.body)).slice(0, 200));
  ok((await call("/api/tasks/R-999"))?.status === 404, "an unknown Task is 404"); }

// ---- Rounds from node visits: a second visit is round 2; a retried visit is attempt 2 of the same round ----
{ const run: any = { id: "R-7", def: { nodes: [{ id: "b", label: "Build", role: "w" }, { id: "rv", label: "Review", role: "r" }] }, nodes: { b: { data: { jobs: [{ id: "J1", cost: { usd: 0.5, inTokens: 10, outTokens: 2 } }, { id: "J2", cost: { usd: 0.25, inTokens: 4, outTokens: 1 } }, { id: "J3", cost: null }] } }, rv: { data: {} } },
    steps: [
      { seq: 1, node: "b", kind: "agent", visit: 1, state: "error", outcome: null, startedAt: "2026-10-14T10:00:00Z", endedAt: "2026-10-14T10:01:00Z", error: "provider exited", job: "J1", provider: "claude", model: "m" },
      { seq: 2, node: "b", kind: "agent", visit: 1, state: "passed", outcome: "ok", startedAt: "2026-10-14T10:01:00Z", endedAt: "2026-10-14T10:03:00Z", error: null, job: "J2", provider: "codex", model: "n" },
      { seq: 3, node: "fix", kind: "loop", visit: 1, state: "passed", outcome: "retry", startedAt: "2026-10-14T10:03:00Z", endedAt: "2026-10-14T10:03:01Z", error: null, job: null },
      { seq: 4, node: "rv", kind: "agent", visit: 1, state: "passed", outcome: "fail", startedAt: "2026-10-14T10:04:00Z", endedAt: "2026-10-14T10:05:00Z", error: null, job: null },
      { seq: 5, node: "b", kind: "agent", visit: 2, state: "running", outcome: null, startedAt: "2026-10-14T10:06:00Z", endedAt: null, error: null, job: "J3", provider: "claude", model: "m" }] };
  const rs = roundsOf(run);
  ok(rs.map((x) => `${x.node}#${x.number}.${x.attempt}`).join(" ") === "b#1.1 b#1.2 rv#1.1 b#2.1", "visits number the Rounds; a retried visit is attempt 2; a refine loop is not a Round", rs.map((x) => `${x.node}#${x.number}.${x.attempt}`).join(" "));
  ok(rs[0]?.outcome === "error" && rs[0]?.reason?.en === "provider exited" && rs[3]?.outcome === "running" && rs[3]?.endedAt === null, "a Round keeps its error, and a running Round has no end", JSON.stringify([rs[0]?.reason, rs[3]?.outcome]));
  ok(rs[0]?.cost?.usd === 0.5 && rs[1]?.cost?.usd === 0.25 && rs[1]?.cost?.seconds === 120 && rs[3]?.cost === null, "each attempt's cost is its own job's", JSON.stringify(rs.map((x) => x.cost)));
  ok(rs.length === 4 && rs[0].id !== rs[1].id && new Set(rs.map((x) => x.id)).size === rs.length, "every Round has its own id"); }

// ---- the alias: the run routes answer under both names ----
const alias: [string, boolean, string | null][] = [["/api/tasks", false, null], ["/api/tasks", true, "/api/wruns"], ["/api/tasks/R-3", false, null], ["/api/tasks/R-3/rounds", false, null],
  ["/api/tasks/R-3/cancel", true, "/api/wruns/R-3/cancel"], ["/api/tasks/R-3/file", false, "/api/wruns/R-3/file"], ["/api/tasks/agents", false, "/api/wruns/agents"],
  ["/api/tasks/R-3/captures/abcdef0/after/index.html", false, "/api/wruns/R-3/captures/abcdef0/after/index.html"], ["/api/wruns/R-3", false, null], ["/api/task/T-3", false, null]];
ok(alias.every(([p, w, want]) => taskAlias(p, w) === want), "/api/tasks paths the run routes serve map to their /api/wruns name", JSON.stringify(alias.filter(([p, w, want]) => taskAlias(p, w) !== want).map(([p, w]) => [p, w, taskAlias(p, w)])));
H.stop();

// ---- the server answers both names ----
const tmp = mkdtempSync(join(tmpdir(), "crew-task-round-"));
const state = join(tmp, "fm", "state"); mkdirSync(state, { recursive: true }); writeFileSync(join(state, "events.jsonl"), "");
const port = await freePort();
const app = Bun.spawn(["bun", "src/server.ts"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: H.data,
  CREW_SANDBOX: "0", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
const base = `http://127.0.0.1:${port}`;
try {
  await waitUp(base, app);
  const get = async (p: string) => { const x = await fetch(base + p); return { status: x.status, body: await x.json().catch(() => null) }; };
  const post = async (p: string, b: any = {}) => { const x = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN! }, body: JSON.stringify(b) }); return { status: x.status, body: await x.json().catch(() => null) }; };
  const t = await get("/api/tasks");
  ok(t.status === 200 && Array.isArray(t.body?.tasks) && Array.isArray(t.body?.cards), "GET /api/tasks answers with Tasks and cards", JSON.stringify(t));
  const w = await get("/api/wruns");
  ok(w.status === 200 && Array.isArray(w.body?.runs), "GET /api/wruns still answers (the alias)", JSON.stringify(w).slice(0, 200));
  ok((await get("/api/tasks/R-999")).status === 404 && (await get("/api/wruns/R-999")).status === 404, "an unknown Task is 404 under both names");
  const ag = await get("/api/tasks/agents");
  ok(ag.status === 200 && Array.isArray(ag.body?.agents), "GET /api/tasks/agents is the run routes' agents list", JSON.stringify(ag).slice(0, 200));
  const p1 = await post("/api/tasks", {}), p2 = await post("/api/wruns", {});
  ok(p1.status === 400 && p1.body?.error === p2.body?.error && /what you want done/.test(p1.body?.error ?? ""), "POST /api/tasks starts a Task exactly as POST /api/wruns does (same checks, same answer)", JSON.stringify([p1, p2]));
  // Real aliased writes and both list names must agree about archived Tasks.
  const hasTask = (x: any) => x.body?.tasks?.some((t: any) => t.id === r.id);
  const hasRun = (x: any) => x.body?.runs?.some((t: any) => t.id === r.id);
  ok(hasTask(await get("/api/tasks")), "the ended fixture Task starts in the default list");
  const archived = await post(`/api/tasks/${r.id}/archive`, { archived: true });
  ok(archived.status === 200 && !hasTask(await get("/api/tasks")) && !hasTask(await get("/api/tasks?archived=0"))
    && !hasRun(await get("/api/wruns")), "POST archive hides the Task from both default lists (archived=0 too)", JSON.stringify({ status: archived.status, archived: archived.body?.archived }));
  ok(hasTask(await get("/api/tasks?archived=1")) && hasRun(await get("/api/wruns?archived=1")),
    "archived=1 includes the archived Task under both API names");
  ok((await get(`/api/tasks/${r.id}`)).status === 200 && (await get(`/api/tasks/${r.id}/rounds`)).body?.rounds?.length === 3,
    "an archived Task's detail and Round history remain accessible");
  const restored = await post(`/api/tasks/${r.id}/archive`, { archived: false });
  ok(restored.status === 200 && hasTask(await get("/api/tasks")) && hasRun(await get("/api/wruns")),
    "POST unarchive restores the Task to both default lists");
  const removed = await post(`/api/tasks/${r.id}/delete`, { confirm: r.id });
  ok(removed.status === 200 && !hasTask(await get("/api/tasks")) && !hasTask(await get("/api/tasks?archived=1"))
    && !hasRun(await get("/api/wruns")) && !hasRun(await get("/api/wruns?archived=1"))
    && (await get(`/api/tasks/${r.id}`)).status === 404 && (await get(`/api/tasks/${r.id}/rounds`)).status === 404,
    "POST delete removes the Task from default and archived lists and its detail/history", JSON.stringify(removed));
  const cross = await fetch(base + "/api/tasks", { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: "{}" });
  ok(cross.status === 403, "the write guard covers the new name too", String(cross.status));
} finally { app.kill(); }
end();
