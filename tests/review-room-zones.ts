import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The room list's zones (docs/units/review-room.md, "Coming back"): every room in 等我看, 審查中, 已結論 or 封存, under its
// repository; archiving is the captain's hand alone, never a merge, and it survives a restart and starting over; nothing is
// cut from the list, and listing reads nothing on GitHub. Rooms are fixture files, GitHub is a stub adapter, the one turn a stub.        bun tests/review-room-zones.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("review-room-zones");
const { installReviewRoom, prRoomId, roomZone, ROOM_ZONES } = await import("../src/domain/review-room");
const { Projects } = await import("../src/doors");
const { must, setGitHome } = await import("../src/git");

// ---------- the rule itself ----------
const facts = (o: any = {}) => ({ archived: false, running: false, concluded: false, waiting: false, ...o });
ok(JSON.stringify(ROOM_ZONES) === '["waiting","reviewing","concluded","archived"]', "four zones, in the order they show");
ok(roomZone(facts({ waiting: true })) === "waiting" && roomZone(facts()) === "reviewing" && roomZone(facts({ concluded: true })) === "concluded" && roomZone(facts({ running: true, waiting: true })) === "reviewing",
  "waiting for the captain, nothing to do, concluded; a running turn is in review even when the captain has a card to answer");
ok(roomZone(facts({ running: true, concluded: true })) === "reviewing", "a turn still running on a concluded room is in review until it ends");
ok(roomZone(facts({ archived: true, running: true, concluded: true, waiting: true })) === "archived", "archived wins over everything");

// ---------- fixtures: a Task at a merge card, a connected project, rooms as files ----------
const tmp = checkedTempDir("crew-room-zones-"), local = join(tmp, "local"); mkdirSync(local); setGitHome(join(tmp, "githome"));
must(local, ["init", "-q", "-b", "main"]); assertTempRepo(local); writeFileSync(join(local, "a.txt"), "one\n");
const id = ["-c", "user.name=t", "-c", "user.email=t@example.test"]; must(local, ["add", "a.txt"]); must(local, [...id, "commit", "-qm", "one"]); const BASE = must(local, ["rev-parse", "HEAD"]);
writeFileSync(join(local, "a.txt"), "two\n"); must(local, [...id, "commit", "-qam", "two"]); const HEAD = must(local, ["rev-parse", "HEAD"]);
const flow = { id: "pr-host", name: "PR host", kind: "code", version: 1, roles: [{ id: "worker", label: "Worker" }, { id: "reviewer", label: "Reviewer", provider: "tutor", model: "t-1" }],
  nodes: [{ id: "prep", kind: "hook", do: "prep", label: "Prepare", x: 1, y: 1 }, { id: "merge-card", kind: "card", label: "Merge", args: { card_kind: "merge" }, card: { title: { en: "Merge", "zh-TW": "合併" }, body: { en: "Merge it.", "zh-TW": "合併。" }, options: [{ id: "merge", label: "Merge", labelZh: "合併", primary: true }, { id: "close", label: "Close", labelZh: "關閉", hold: true }] }, x: 2, y: 1 },
    { id: "review", kind: "agent", mode: "review", role: "reviewer", label: "Review", x: 3, y: 1 }, { id: "done", kind: "hook", label: "Done", x: 4, y: 1 }],
  edges: [{ from: "prep", to: "merge-card" }, { from: "merge-card", to: "review", when: "close" }, { from: "review", to: "merge-card", when: "pass" }, { from: "merge-card", to: "done", when: "merge" }] };
const H = await harness([Y(flow)]), E = H.engine, REPO = "fixture/project";
writeFileSync(join(H.data, "projects.json"), JSON.stringify([{ id: "proj", name: "project", path: local, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true, github: { repository: REPO } }]));
// GitHub, stubbed: what each pull request is now, and every read of one
const remote = new Map<number, any>(), reads: number[] = [];
const adapter: any = { grant: { repository: REPO }, async fetchPull() { throw new Error("fixture: no commits to fetch"); },
  async remoteRead(kind: string, n: string) { if (kind !== "pull") return []; reads.push(Number(n)); const p = remote.get(Number(n)); return { number: Number(n), html_url: `https://github.com/${REPO}/pull/${n}`, state: p?.state ?? "open", merged: !!p?.merged, merged_at: p?.merged ? "2026-11-01T00:00:00Z" : null, title: "T", body: "", head: { sha: HEAD, ref: "x", repo: { full_name: REPO } }, base: { ref: "main", repo: { full_name: REPO } }, user: { login: "a" } }; } };
const install = () => installReviewRoom(E, { dataDir: H.data, projects: new Projects(H.data), github: () => adapter, web: { search: async () => ({ configured: false }), fetch: async () => { throw new Error("no web in this test"); } } });
let room = install();
E.actions.prep = async (x: any) => { Object.assign(x.ctx, { project: "proj", repo: local, worktree: local, baseCommit: BASE, head: HEAD, pr: { adapter: "github", id: "1", url: `https://github.com/${REPO}/pull/1`, head: HEAD } }); x.save(); return "ok"; };
const turn = (n: number, o: any = {}) => ({ n, action: "teach", text: "x", lang: "en", by: "captain", at: "2026-11-01T10:00:00.000Z", status: "done", ended: "2026-11-01T10:05:00.000Z", job: null, provider: "p", model: "m", effort: null, answer: "a", error: null, cost: null, round: "r", head: HEAD, ...o });
const base = (card: string) => ({ schema: 1, run: "", card, node: "", head: HEAD, base: BASE, turns: [] as any[], board: [], sources: [], check: { questions: [] } });
const prDir = join(H.data, "review-room", "pr"), dirDir = join(H.data, "review-room", "dir"); mkdirSync(prDir, { recursive: true }); mkdirSync(dirDir, { recursive: true });
const recent = () => new Date().toISOString();
/** a pull request's room as Studio keeps it; read: the time its pull request was last read */
function pr(n: number, o: any = {}, snap: any = {}) { const rid = prRoomId(REPO, n), url = `https://github.com/${REPO}/pull/${n}`;
  writeFileSync(join(prDir, `${rid}.json`), JSON.stringify({ ...base(rid), subject: { kind: "pr", room: rid, url, repository: REPO, number: n, project: "proj", task: null },
    pr: { title: `PR ${n}`, body: "", state: "open", merged: false, mergedAt: null, closedAt: null, draft: false, author: "a", headRef: "x", headRepo: REPO, baseRef: "main", head: HEAD, base: BASE, files: [], notes: [], checkedAt: recent(), attemptedAt: recent(), truncated: false, stale: null, ...snap }, ...o })); return rid; }
const zone = (rid: string) => room.list().find((x: any) => x.id === rid)?.zone;

// ---------- which zone a pull request's room is in ----------
const blank = pr(1), answered = pr(2, { turns: [turn(1)] }), read = pr(3, { turns: [turn(1)], read: "2026-11-01T11:00:00.000Z" }), oldHead = pr(4, { turns: [turn(1, { head: BASE })], read: "2026-11-01T11:00:00.000Z" }),
  failed = pr(5, { turns: [turn(1), turn(2, { status: "failed", ended: "2026-11-01T10:06:00.000Z" })], read: "2026-11-01T11:00:00.000Z" }),
  merged = pr(6, { turns: [turn(1)] }, { state: "closed", merged: true }), closed = pr(7, {}, { state: "closed" }), inTurn = pr(8, { turns: [turn(1), turn(2, { status: "running", ended: null })] });
ok(zone(blank) === "waiting", "no analysis yet: nothing happens until the captain acts", zone(blank));
ok(zone(answered) === "waiting", "an answer the captain has not opened waits for them", zone(answered));
ok(zone(read) === "reviewing", "the answer read, the pull request still open: in review, not waiting on the captain", zone(read));
ok(zone(oldHead) === "waiting", "new commits since the last answer wait for the captain", zone(oldHead));
ok(zone(failed) === "waiting", "a last turn that failed waits for the captain", zone(failed));
ok(zone(merged) === "concluded", "a merged pull request is concluded, not archived", zone(merged));
ok(zone(closed) === "concluded", "a closed pull request is concluded even with no turn (no `finished` was recorded for it)", zone(closed));
ok(zone(inTurn) === "waiting", "a turn left running by a Studio that stopped is not in progress: it waits for the captain", zone(inTurn));
const reopened = pr(9, { turns: [turn(1)], read: "2026-11-01T11:00:00.000Z", finished: { at: "2026-11-01T11:00:00.000Z", reason: "The pull request was closed" } });
const stalePr = pr(10, { turns: [turn(1)], read: "2026-11-01T11:00:00.000Z" }, { stale: { head: "f".repeat(40), error: "fetch failed", at: recent() } });
ok(room.list().find((x: any) => x.id === inTurn)?.updatedAt === turn(1).ended, "a turn with no end yet leaves a room's time at its last answer");
ok(zone(stalePr) === "waiting", "GitHub shows newer commits Studio could not fetch: they wait for the captain all the same", zone(stalePr));
ok(zone(reopened) === "reviewing", "a pull request reopened on GitHub leaves 已結論: its state decides, not the old `finished` mark", zone(reopened));

// ---------- reading a room is what clears 等我看 ----------
room.view(answered); ok(zone(answered) === "waiting", "a read that is not the captain opening the page changes nothing");
{ const said: string[] = [], send = E.deps.send; E.deps.send = (t: string, d: any) => { if (t === "review-room") said.push(d.card); return (send as any)(t, d); }; room.view(answered, true); room.view(answered, true); E.deps.send = send;
  ok(zone(answered) === "reviewing", "the captain opening the room reads its answer", zone(answered));
  ok(JSON.stringify(said) === JSON.stringify([answered]), "reading it tells a list open in another window, once", JSON.stringify(said)); }
{ const stored = JSON.parse(readFileSync(join(prDir, `${answered}.json`), "utf8")); stored.turns.push(turn(2, { ended: new Date(Date.now() + 60_000).toISOString() })); writeFileSync(join(prDir, `${answered}.json`), JSON.stringify(stored)); room = install();
  ok(zone(answered) === "waiting", "a newer answer waits for the captain again, and the read mark outlives a restart", zone(answered)); }

// ---------- a directory has no result of its own ----------
{ const did = "DIR-0123456789ab-0123456789ab", d = (o: any) => writeFileSync(join(dirDir, `${did}.json`), JSON.stringify({ ...base(did), subject: { kind: "dir", room: did, url: "https://github.com/acme/kit/tree/main/src", repository: "acme/kit", ref: "main", path: "src", project: null, task: null }, dir: { repository: "acme/kit", ref: "main", refKind: "branch", sha: HEAD, path: "src", private: false, files: 1, bytes: 1, parts: [], truncated: false, fetchedAt: recent() }, ...o }));
  d({}); room = install(); ok(zone(did) === "waiting", "a directory not analysed yet waits for the captain", zone(did));
  d({ turns: [turn(1)] }); room = install(); ok(zone(did) === "waiting", "its analysis not opened yet waits for the captain", zone(did));
  d({ turns: [turn(1)], read: "2026-11-01T11:00:00.000Z" }); room = install(); ok(zone(did) === "concluded", "analysed and read, a pinned directory is concluded: it never stays in review", zone(did)); }

// ---------- a merge card's room: its repository comes from its Task, its card decides ----------
const host = E.start({ workflow: "pr-host", params: {} }); await until(() => E.cards.list({ run: host.id, open: true }).length > 0, 20000);
const card = E.cards.list({ run: host.id, open: true })[0], cardFile = join(E.rdir(host.id), "review-room", `${card.id}.json`);
ok(!room.list().some((x: any) => x.id === card.id), "fixture: a merge card's room with no turn has no file, so it is not listed");
{ const a: any = room.archive(card.id, true, "captain");
  ok(a.archived && a.zone === "archived" && room.list().find((x: any) => x.id === card.id)?.zone === "archived", "archiving a room with no file yet gives it one: it is listed in 封存, not lost", JSON.stringify({ a: a.zone })); }
ok(room.list().find((x: any) => x.id === card.id)?.repository === REPO, "a merge card's room is listed under its Task's repository", JSON.stringify(room.list().find((x: any) => x.id === card.id)));
{ const a: any = room.archive(card.id, false, "captain"); ok(!a.archived && a.zone === "waiting" && a.view.archived === false, "restored, an open merge card's room waits for the captain", JSON.stringify({ zone: a.zone })); }
const stored = JSON.parse(readFileSync(cardFile, "utf8")); ok(stored.archived === undefined, "restoring clears the mark from the file");
await E.answer(card.id, { choice: "merge", by: "captain" }); await until(() => E.cards.get(card.id)?.status !== "open", 20000);
ok(zone(card.id) === "concluded", "the merge card answered: concluded, and the merge did not archive it", zone(card.id));

// ---------- archiving: by hand, durable, kept by start-over, and it starts nothing by itself ----------
const archivedPr = pr(20, { turns: [turn(1, { head: BASE })], read: "2026-11-01T11:00:00.000Z" }); room = install();
const a0 = zone(archivedPr), arc: any = room.archive(archivedPr, true, "captain");
ok(a0 === "waiting" && arc.zone === "archived" && zone(archivedPr) === "archived" && arc.view.archived === true, "the captain archives a room: it moves to 封存", JSON.stringify({ a0, z: arc.zone }));
ok(arc.view.turns.length === 1, "archiving loses nothing of the room");
room = install(); ok(zone(archivedPr) === "archived" && JSON.parse(readFileSync(join(prDir, `${archivedPr}.json`), "utf8")).archived?.by === "captain", "the archive survives a restart: it is in the room's own file under the data folder");
{ const h2 = E.start({ workflow: "pr-host", params: {} }); await until(() => E.cards.list({ run: h2.id, open: true }).length > 0, 20000); const c2 = E.cards.list({ run: h2.id, open: true })[0].id, before: any = room.view(c2);
  ok(before.arrive?.plan, "fixture: an open room with auto-teach on would start its analysis on arrival", JSON.stringify(before.arrive));
  room.archive(c2, true, "captain"); const seen: any = room.view(c2, true); ok(seen.arrive === null, "an archived room offers no automatic analysis on arrival", JSON.stringify(seen.arrive));
  await room.arrive(c2, "captain", "en", before.arrive.plan); ok(!JSON.parse(readFileSync(join(E.rdir(h2.id), "review-room", `${c2}.json`), "utf8")).autoTaught, "arriving in an archived room, even on the plan it showed before, starts nothing");
  // a running turn: in review even with the merge card open, through the real room
  { let release = () => {}; const held = new Promise<void>((r) => { release = r; }), baseProvider = E.deps.provider;
    E.deps.provider = (pid?: string, model?: string) => pid === "tutor" ? ({ id: pid, model: model ?? "", sandboxFree: true, start() { return { interrupt() {}, async *send() { await held; yield { type: "delta", text: "Answer." } as any; yield { type: "turnEnd", status: "ok", usage: { usd: 0, inTokens: 1, outTokens: 1 } } as any; } }; } }) as any : baseProvider(pid, model);
    room.archive(c2, false, "captain"); ok(zone(c2) === "waiting", "fixture: a merge room with its card open waits for the captain", zone(c2));
    await room.start(c2, { action: "ask", text: "Why?", lang: "en", confirm: (room.view(c2) as any).offer.hash }, "captain"); ok(zone(c2) === "reviewing", "a turn running on the room puts it in review, whatever else holds", zone(c2));
    release(); await room.settle(c2, 15000); ok(zone(c2) === "waiting", "the turn ended, the open card waits for the captain again", zone(c2)); E.deps.provider = baseProvider;
    const file = () => JSON.parse(readFileSync(join(E.rdir(h2.id), "review-room", `${c2}.json`), "utf8")); ok(!file().read, "fixture: the answer is not read yet"); room.view(c2, true); ok(!!file().read, "opening a merge card's room reads its answer"); }
  // start-over keeps the mark on a merge card's room, and when its subject is gone
  { room.archive(c2, true, "captain"); room.reset(c2, "captain"); ok(zone(c2) === "archived", "starting over an archived merge card's room keeps it archived", zone(c2));
    const ctx = E.get(h2.id)!.ctx, was = { worktree: ctx.worktree, repo: ctx.repo }; Object.assign(ctx, { worktree: join(tmp, "gone"), repo: join(tmp, "gone") }); room.reset(c2, "captain"); Object.assign(ctx, was);
    ok(zone(c2) === "archived", "and when its repository is gone: the room stays listed in 封存", zone(c2)); room.archive(c2, false, "captain"); }
  // a Task's branch whose review has not passed opens no room, by archiving either
  { const e: any = (() => { try { room.archive(h2.id, true, "captain"); return null; } catch (x) { return x; } })(); ok(e?.code === "not_reviewed", "archiving does not open a room Studio has not let open", e?.message); }
  // a Task's branch: in review while the Task runs, concluded once it ended
  const branch = join(E.rdir(h2.id), "review-room", `${h2.id}.json`); writeFileSync(branch, JSON.stringify({ ...base(h2.id), run: h2.id, node: "review", turns: [turn(1)], read: "2026-11-01T11:00:00.000Z" })); room = install();
  ok(zone(h2.id) === "reviewing", "a Task's branch, read, while its Task runs: in review", zone(h2.id));
  ok(room.list().find((x: any) => x.id === h2.id)?.repository === REPO, "a branch's room is listed under its Task's repository");
  { const ctx = E.get(h2.id)!.ctx, was = ctx.pr; ctx.pr = { ...was, url: "https://github.com/other/repo/pull/2" }; ok(room.list().find((x: any) => x.id === h2.id)?.repository === "other/repo", "its Task's pull request says first"); ctx.pr = was; }
  { const ctx = E.get(h2.id)!.ctx, was = ctx.pr; ctx.pr = null; ok(room.list().find((x: any) => x.id === h2.id)?.repository === REPO, "with no pull request, its project's repository says"); ctx.pr = was; }
  { const ctx = E.get(h2.id)!.ctx; ctx.head = BASE; ok(zone(h2.id) === "waiting", "the branch moved past its last answer: it waits for the captain", zone(h2.id)); ctx.head = HEAD; }
  await E.cancel(h2.id, "cleanup"); await until(() => ["succeeded", "failed", "cancelled"].includes(E.get(h2.id)!.status), 20000);
  ok(zone(h2.id) === "concluded", "its Task ended: concluded", zone(h2.id)); }
const rs: any = room.reset(archivedPr, "captain"); ok(rs.reset && rs.view.turns.length === 0 && rs.view.archived === true && zone(archivedPr) === "archived", "starting an archived room over keeps it archived; start-over is not restore", JSON.stringify({ a: rs.view.archived }));
const back: any = room.archive(archivedPr, false, "captain"); ok(back.zone === "waiting" && zone(archivedPr) === "waiting", "restored, a room goes to the zone it belongs in now", back.zone);

// ---------- the Task's archive is a different thing ----------
{ const m = E.get(host.id)!; await until(() => ["succeeded", "failed", "cancelled"].includes(E.get(host.id)!.status), 20000);
  E.archive(m.id, true, "captain"); ok(zone(card.id) === "concluded" && room.list().some((x: any) => x.id === card.id), "archiving a Task leaves its room where it is: the two archives are separate", zone(card.id)); E.archive(m.id, false, "captain"); }

// ---------- the list reads only what Studio holds: GitHub is read when the captain enters or checks a room ----------
const stale = "2026-01-01T00:00:00.000Z", lagging = pr(31, { turns: [turn(1)], read: "2026-11-01T11:00:00.000Z" }, { attemptedAt: stale, checkedAt: stale }); room = install(); remote.set(31, { state: "closed", merged: true }); reads.length = 0;
room.list(); ok(!reads.length && zone(lagging) === "reviewing", "listing reads nothing on GitHub: a pull request merged there stays where it was", JSON.stringify(reads));
room.view(lagging, true); await until(() => reads.length > 0, 5000); await room.settle("none", 5000);
const m31: any = room.list().find((x: any) => x.id === lagging);
ok(m31.zone === "concluded" && !JSON.parse(readFileSync(join(prDir, `${lagging}.json`), "utf8")).archived, "entering the room reads it: merged, it moves to 已結論, and is not archived", JSON.stringify(m31));
ok(m31.updatedAt === turn(1).ended, "a room's time on the list is its last answer's: a re-read of GitHub is not news", m31.updatedAt);
const skipArchived = pr(38, { archived: { by: "captain", at: stale } }, { attemptedAt: stale, checkedAt: stale }); room = install(); remote.set(38, { state: "closed", merged: true }); room.view(skipArchived, true); await until(() => reads.includes(38), 5000); await room.settle("none", 5000);
ok(zone(skipArchived) === "archived", "an archived room stays archived whatever GitHub says");

// ---------- the route: a POST by the captain on this Mac ----------
{ const { createRuntime } = await import("../src/runtime"), { StudioLog } = await import("../src/rawlog"), { stubProvider } = await import("../src/providers/stub");
  const rt = createRuntime({ dataDir: H.data, agents: H.agents, provider: () => ({ ...stubProvider(), id: "stub", model: "no model" }) as any, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(H.data, "events.jsonl")), send: () => {}, fmRoot: join(H.data, "..", "no-fm"), studioUrl: () => "",
    install: [(e: any) => { e.reviewRoom = installReviewRoom(e, { dataDir: H.data, projects: new Projects(H.data), github: () => adapter, web: { search: async () => ({ configured: false }), fetch: async () => { throw new Error("no web in this test"); } } }); }] } as any);
  const call = async (method: string, path: string, body: any, who: any, writing: boolean) => { const url = new URL(`http://studio.test${path}`); const res = await rt.handle(new Request(url, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }), url, who, writing); return { status: res!.status, body: await res!.json() }; };
  const rid = pr(40, { turns: [turn(1)], read: "2026-11-01T11:00:00.000Z" }), desk = { kind: "desktop" }, phone = { kind: "phone" }, path = `/api/review-room/${rid}/archive`;
  ok((await call("GET", path, null, desk, false)).status === 405, "the route takes POST only");
  ok((await call("POST", path, {}, phone, true)).status === 403, "a phone does not archive");
  const on = await call("POST", path, {}, desk, true), listed = await call("GET", "/api/review-room", null, desk, false);
  ok(on.status === 200 && on.body.zone === "archived" && listed.body.rooms.find((x: any) => x.id === rid)?.zone === "archived", "the captain archives through the route, and the list says so", JSON.stringify([on.status, on.body.zone]));
  const off = await call("POST", path, { archived: false }, desk, true); ok(off.status === 200 && off.body.zone === "reviewing", "{archived: false} restores it", JSON.stringify(off.body.zone));
  ok((await call("POST", path, { archived: "false" }, desk, true)).status === 400 && zone(rid) !== "archived", "archived is a boolean: anything else is refused, never archived"); }

// ---------- nothing is cut from the list ----------
{ const many = Array.from({ length: 70 }, (_, i) => pr(100 + i, { archived: { by: "captain", at: stale } })); room = install(); const ids = new Set(room.list().map((x: any) => x.id));
  ok(many.every((x) => ids.has(x)), "every room is listed, however many: the search covers all of them, 封存 included", String(ids.size)); }

await end();
