import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Studio's read tools, phase 2 (docs/units/observe.md): the kinds every other board page shows (workflow, project, skill,
// crew, terminal, artifact, doc, doctor, settings, peer), each read through the page's own function and declaring every
// field's trust; studio_logs (a terminal's screen only when the captain asked this turn) and studio_events (Studio's event
// log with a cursor, the retro's signals and the captain's notes); acceptance questions 5 to 7.
//      bun tests/observe-kinds.ts
import { suite } from "./rt-harness";
import { observeP2Fixture, INJECTION, ROOM, REPO, SECRET } from "./lib/observe-p2-fixture";
import { BUDGET, kinds, kindDef, shape } from "../src/observe/registry";
import { captainAskedForScreen } from "../src/observe/kinds/terminal";
import { docRows } from "../src/docs";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("observe-kinds");
const J = (v: unknown) => JSON.stringify(v);
const bytes = (v: unknown) => Buffer.byteLength(J(v));
/** text outside untrusted wrappers: the injection line must never be there */
const bare = (v: unknown) => J(v).replace(/\{"untrusted":true,"source":"[^"]*","text":"(?:[^"\\]|\\.)*"\}/g, "");
const failOf = async (f: () => unknown) => { try { await f(); return null; } catch (e: any) { return { code: e?.publicFailure?.code ?? null, en: String(e?.message ?? e) }; } };
const F = await observeP2Fixture(), O = F.observe;
try {
  // ---------- every kind lists, reads, stays in budget, and never shows someone else's words bare ----------
  for (const k of kinds()) {
    const l: any = await O.call("studio_list", { kind: k });
    ok(l.items.length > 0 && bytes(l) <= BUDGET.summary, `${k}: listed within 4 KB`, `${l.items.length} ${bytes(l)}`);
    const g: any = await O.call("studio_get", { ref: l.items[0].ref, depth: "full" });
    ok(g.ref === l.items[0].ref && bytes(g) <= BUDGET.full && !bare(g).includes("IGNORE ALL") && !bare(l).includes("IGNORE ALL"), `${k}: read whole, the injection line only inside untrusted text`, bare(g).slice(0, 200));
    ok(!J(g).includes(SECRET) && !J(l).includes(SECRET), `${k}: no secret`);
  }
  // studio_now with a P2 page in focus: the page's ref and board route come from its kind; the waiting cards keep their urgency
  for (const k of ["skill", "workflow", "doc", "project"]) {
    const ref = (await O.call("studio_list", { kind: k }) as any).items[0].ref, def = kindDef(k)!;
    F.focus.put("tab-p2", { route: def.listRoute, ref, selection: null, dialog: null, label: `${k} page` });
    const n: any = await O.call("studio_now", {});
    ok(n.data.focus.current?.ref === ref && typeof n.data.focus.current.open === "string" && n.data.focus.current.open.startsWith("#/") && n.data.waiting.every((w: any) => typeof w.urgency === "string") && !bare(n).includes("IGNORE ALL"),
      `studio_now: a ${k} page in focus shows its ref and board route; waiting cards keep their urgency`, J(n.data.focus.current)); }
  ok(kinds().every((k) => kindDef(k)!.fields.length > 0) && !J(shape(kindDef("doctor")!, { id: "x", undeclared: "y" }).data).includes("undeclared"), "every kind declares its fields; an undeclared one is never emitted");

  // ---------- consistency: each kind reads what its page's own function returns ----------
  { const wf: any = await O.call("studio_list", { kind: "workflow" }), cat = F.E.defs.list();
    ok(wf.data.total === cat.length && wf.data.entries.every((e: any) => { const w = cat.find((x: any) => x.id === e.id)!; return w && e.version === w.version && e.versions === w.versions && e.nodes === w.nodes && (e.name ?? e.importedName?.text) === (w.displayName ?? w.name); }),
      "workflow: the Workflows page's catalog rows (WorkflowDefs.list, GET /api/wf)", J(wf.data.entries[0])); }
  { const view = F.artifacts.view(), a: any = await O.call("studio_get", { ref: "artifact:harbor-banner", depth: "full" }), row = view.find((x: any) => x.id === "harbor-banner")!;
    ok(a.data.latest === row.latest && a.data.approved === row.approved && a.data.versions.length === row.versions.length && a.data.versions[0].n === row.versions.at(-1)!.n && a.data.versions[0].summary?.untrusted === true,
      "artifact: the Library's rows (ArtifactStore.view, GET /api/artifacts), the maker's summary untrusted", J(a.data.versions[0])); }
  { const rows = docRows(F.artifacts), d: any = await O.call("studio_get", { ref: "doc:tide-brief", depth: "full" }), row = rows.find((x: any) => x.id === "tide-brief")!;
    ok(rows.length === 1 && d.data.words === row.words && d.data.openNotes === row.openNotes && d.data.text?.untrusted === true && /Tide brief/.test(d.data.text.text), "doc: the Documents page's rows (docRows, GET /api/docs), its text untrusted", J(d.data).slice(0, 300)); }
  { const lib = F.skills.library(), sk: any = await O.call("studio_get", { ref: "skill:baton" });
    const b = lib.find((x: any) => x.id === "baton")!; ok(sk.data.current === b.current && sk.data.versions.length === b.versions.length && sk.data.skillDescription?.untrusted === true && sk.route === "#/skills/baton", "skill: the Skills page's rows (Skills.library, GET /api/skills); an imported skill's own words untrusted", J(sk.data).slice(0, 300)); }
  { const pr: any = await O.call("studio_list", { kind: "project" }), side = F.overview.sidebar().projects;
    ok(J(pr.items.map((x: any) => x.ref)) === J(side.map((x: any) => `project:${x.id}`)) && pr.data.entries.every((e: any, i: number) => e.attention === side[i].attention && J(e.status) === J(side[i].status)), "project: the Projects page's sidebar rows (sidebar(), GET /api/projects/overview)", J(pr.data.entries[0]));
    const one: any = await O.call("studio_get", { ref: "project:harbor-app", depth: "full" }), page = F.overview.page("harbor-app");
    ok(one.data.id === page.project.id && one.data.canStart === page.project.canStart && Array.isArray(one.data.health) && one.data.health.length === page.health.length, "project: one project's page (page(id))", J(one.data).slice(0, 300)); }
  { const t: any = await O.call("studio_list", { kind: "terminal" });
    ok(t.items.length === 2 && t.data.entries[0].state === F.terms[0].state && t.data.entries[0].waitsForInput === true && !J(t).includes("Proceed") && !J(t).includes("remote-fixture"), "terminal: the Terminals page's list (Terminals.list), state only: no question text, no remote-control link", J(t.data.entries[0])); }
  { const d: any = await O.call("studio_list", { kind: "doctor", filter: { status: "missing" } }), all: any = await O.call("studio_get", { ref: "doctor:claude" });
    ok(d.items.length === 1 && d.data.entries[0].fix === F.doctorItems[1].fix && !J(all).includes(process.env.HOME ?? "/nohome") && /~\/\.local\/bin\/claude/.test(all.data.detail.text) && all.data.detail.untrusted === true && all.data.version.untrusted === true, "doctor: Doctor's rows, filtered; a home path shown as ~; its detail and version (the tool's output) untrusted", J(all.data));
    const keys: any = await O.call("studio_get", { ref: "doctor:keys" });
    ok(!J(keys).includes("hunter2pass") && !J(keys).includes("ops:") && /endpoint https:\/\/\[credential removed\]@api\.example\.invalid/.test(keys.data.detail.text), "doctor: an endpoint's URL credentials never show", J(keys.data)); }
  { const st: any = await O.call("studio_get", { ref: "settings:studio" });
    ok(st.data.chat.provider === "claude" && st.data.keys.anthropic === true && !("token" in st.data) && !("apiKey" in st.data) && !J(st).includes(SECRET), "settings: the non-secret part only; a key or token never", J(st.data)); }
  { const p: any = await O.call("studio_list", { kind: "peer" });
    ok(p.items.length === 2 && !J(p).includes("192.168") && !J(p).includes("kkkk") && !J(p).includes("hhhh") && !J(p).includes("MIRA") && p.data.entries[0].petname === "Mira's Studio" && p.data.entries[1].deviceName?.untrusted === true, "peer: redacted (no key, address or hash; not what a peer calls itself); the petname is the captain's", J(p.data.entries)); }
  { const c: any = await O.call("studio_get", { ref: "crew:worker" });
    ok(c.data.provider === "codex" && J(c.data.skills) === J(["baton@v2"]) && c.data.team.version === 3, "crew: the approved team's seat (teamBody)", J(c.data)); }

  // ---------- acceptance 5: which version of baton, are its scripts approved, is its environment ready ----------
  { const found: any = await O.call("studio_find", { query: "baton" });
    const ref = found.items.find((x: any) => x.kind === "skill")?.ref, sk: any = await O.call("studio_get", { ref });
    ok(ref === "skill:baton" && sk.data.version === 2 && sk.data.current === 2 && sk.data.package.decision?.scripts === "approved" && sk.data.package.decision.by === "captain" && sk.data.package.scripts === 1,
      "Q5: baton is at v2, its script approved by the captain", J(sk.data.package));
    ok(sk.data.package.ready === true && sk.data.package.state === "ready" && !!sk.data.package.preparedAt && sk.data.package.blocking === false, "Q5: its environment is prepared (it needs no packages) and it is ready to run", J(sk.data.package));
    const v1: any = await O.call("studio_get", { ref: "skill:baton@v1" });
    ok(v1.data.version === 1 && v1.data.latest === false && v1.data.package === null && v1.route === "#/skills/baton%401", "Q5: v1 reads on its own (no scripts), routed as the Skills page writes it", J(v1)); }

  // ---------- acceptance 6: which terminal waits for my input (state only) ----------
  { const w: any = await O.call("studio_list", { kind: "terminal", filter: { waiting: true } });
    ok(w.items.length === 1 && w.items[0].ref === `terminal:${F.terms[0].id}` && w.data.entries[0].reason === "question" && !J(w).includes("Proceed"), "Q6: one terminal waits for input; its state, not its screen", J(w.data.entries));
    const nolog: any = await O.call("studio_logs", { ref: w.items[0].ref, tail: 10 });
    ok(nolog.data.screen.shown === false && !J(nolog).includes("Proceed") && !J(nolog).includes("failing") && nolog.data.state.waitsForInput === true, "Q6: studio_logs gives a terminal's state only when the captain did not ask for its screen", J(nolog.data));
    const asked: any = await O.call("studio_logs", { ref: w.items[0].ref, tail: 10 }, { captainAskedTail: true });
    ok(asked.data.screen.shown === true && asked.data.screen.text?.untrusted === true && /npm test/.test(asked.data.screen.text.text) && asked.data.screen.ask?.untrusted === true && !bare(asked).includes("IGNORE"), "the captain asked this turn: the screen's last lines, wrapped as untrusted", J(asked.data.screen).slice(0, 300));
    ok(captainAskedForScreen("show me what the terminal printed") && captainAskedForScreen("終端機的輸出給我看") && !captainAskedForScreen("which terminal waits for me?") && !captainAskedForScreen("what does the room say"),
      "whether the captain asked is read from the captain's words: naming a terminal and its output"); }

  // ---------- acceptance 7: what did the last explain cost, why did it stop ----------
  { const lg: any = await O.call("studio_logs", { ref: `room:${ROOM}` });
    const last = lg.data.explain.at(-1);
    ok(last.cost.usd === 0.61 && last.why === "limit" && /10-minute safety limit/.test(last.stop) && lg.data.events.some((e: any) => e.type === "room_round_failed" && e.data.why === "limit"), "Q7: the last page run cost $0.61 and stopped at its safety limit; the log has the failed round", J(lg.data.explain));
    ok(J(lg.data.explain.map((r: any) => [r.n, r.kind])) === J([[1, "generate"], [2, "ask"], [3, "generate"]]) && lg.data.cost.usd === 1.28 && !("turns" in lg.data) && J(Object.keys(lg.data).sort()) === J(["cost", "events", "explain", "more"]),
      "a room's log is its runs, a page or a question, oldest first, its events and what it all cost: no tutor turns", J(Object.keys(lg.data)));
    ok(!!lg.nextCursor && Number.isFinite(Date.parse(lg.nextCursor)), "studio_logs returns a cursor to read on (a room's: a time)", String(lg.nextCursor));
    const seqOnTime = await failOf(() => O.call("studio_logs", { ref: `room:${ROOM}`, since: "seq:3" }));
    ok(/since is a time here/.test(seqOnTime?.en ?? ""), "a cursor of the other kind is refused, saying which", J(seqOnTime)); }

  // ---------- paging a log: more new entries than tail, and a page cut to its budget, lose none ----------
  { const rr: any = F.reviewRoom, xview0 = rr.explain.view, t0 = Date.now() - 3600_000;
    const asks = Array.from({ length: 30 }, (_, i) => ({ n: 10 + i, kind: "ask", skill: { id: "baton", v: 2, name: "baton" }, question: `q${i}`, at: new Date(t0 + i * 60_000).toISOString(), ended: new Date(t0 + i * 60_000 + 1000).toISOString(), status: "failed", provider: "codex", model: "m", rounds: [], error: `round ${i} failed: ` + "E".repeat(420), cost: { usd: 0.01 } }));
    rr.explain.view = (id: string) => { const x = xview0(id); x.runs = [...x.runs, ...asks]; return x; };
    try {
      const all = new Set<number>(), seen: number[] = []; let cur: string | undefined = new Date(t0 - 1).toISOString(), pages = 0, over = false, cut = false;
      do { const pg: any = await O.call("studio_logs", { ref: `room:${ROOM}`, tail: 20, since: cur }); pages++; over ||= Buffer.byteLength(J(pg)) > BUDGET.summary; cut ||= pg.data.explain.length + pg.data.events.length < 20 && pg.data.more;
        pg.data.explain.forEach((r: any) => { seen.push(r.n); all.add(r.n); }); if (!pg.data.more) break; cur = pg.nextCursor; } while (pages < 40);
      ok([...Array(30).keys()].every((i) => all.has(10 + i)) && seen.length === all.size && !over && cut, "30 new questions with tail 20, pages cut to 4 KB: every run comes once, none skipped", `${all.size} in ${pages} pages`);
      const latest: any = await O.call("studio_logs", { ref: `room:${ROOM}`, tail: 5 });
      const times = [...latest.data.explain.map((r: any) => r.ended ?? r.at), ...latest.data.events.map((e: any) => e.at)].map((x: string) => Date.parse(x));
      ok(latest.data.explain.length + latest.data.events.length === 5 && Date.parse(latest.nextCursor) === Math.max(...times), "without since: the newest five, and the cursor is the last one shown", J([latest.data.explain.map((r: any) => r.n), latest.nextCursor]));
    } finally { rr.explain.view = xview0; } }

  // ---------- studio_logs: a Task's steps and events; a pull request's go-live timeline; errors ----------
  { const t: any = await O.call("studio_logs", { ref: `task:${F.ids.failed}` });
    ok(t.data.status === "failed" && t.data.steps.some((x: any) => x.node === "deploy" && x.label === "Deploy to staging") && t.data.events.length > 0 && Number.isFinite(Date.parse(t.nextCursor)), "a Task's log: its steps and events, with a cursor (a time)", J(t.data).slice(0, 300));
    const again: any = await O.call("studio_logs", { ref: `task:${F.ids.failed}`, since: t.nextCursor });
    ok(again.data.events.length === 0 && again.data.steps.length === 0 && again.nextCursor === t.nextCursor, "read on from the cursor: nothing new (no step sent again), the same cursor", J(again.data));
    const pr: any = await O.call("studio_logs", { ref: `pr:${REPO}#1601` });
    ok(J(pr.data.events.map((e: any) => e.type)) === J(["pr_merged", "pr_live_partial", "captain_note"]) && pr.data.waitsAt === "staging: tide-api (v1.4.0-1a2b3c4)", "a pull request's go-live timeline", J(pr.data));
    const none = await failOf(() => O.call("studio_logs", { ref: "skill:baton" }));
    ok(none?.code === "invalid_params" && /studio_logs reads task, room, pr, terminal/.test(none.en) && /studio_get/.test(none.en), "a kind without a log says which kinds have one and to use studio_get", J(none));
    const badSince = await failOf(() => O.call("studio_logs", { ref: `task:${F.ids.failed}`, since: "yesterday" }));
    ok(/seq:N/.test(badSince?.en ?? ""), "a bad since says what it takes", J(badSince)); }

  // ---------- studio_events: the log with a cursor; signals, notes and other lines at their trust ----------
  { const ev: any = await O.call("studio_events", {});
    const types = ev.data.events.map((e: any) => e.type).filter((t: string) => !t.startsWith("run_") || t === "run_failed");
    ok(J(types) === J(["run_failed", "room_round_failed", "pr_merged", "pr_live_partial", "captain_note", "terminal"]) && /^seq:\d+$/.test(ev.nextCursor), "studio_events: the latest events, oldest first, with a cursor", J(types));
    const note = ev.data.events.find((e: any) => e.type === "captain_note");
    ok(note.note.text === "The deploy card hid the pod name" && note.note.context?.untrusted === true && /selected page text/.test(note.note.context.text) && note.refs.includes(`pr:${REPO}#1601`), "a captain's note: the captain's words at captain trust, the page text selected with it untrusted", J(note));
    const line = ev.data.events.find((e: any) => e.type === "terminal");
    ok(line.line?.untrusted === true && !("summary" in line) && !("data" in line), "a line that may quote a tool: its summary untrusted, none of its data", J(line));
    const failed = ev.data.events.find((e: any) => e.type === "run_failed");
    ok(failed.summary && failed.data.failure === "internal.unmapped" && failed.refs.includes(`task:${F.ids.failed}`), "a retro signal: codes and refs, at Studio's trust", J(failed));
    const none: any = await O.call("studio_events", { since: ev.nextCursor });
    ok(none.data.events.length === 0 && none.nextCursor === ev.nextCursor, "read on: nothing new, the same cursor");
    F.log.emit({ type: "pr_live", workflow: "studio", summary: `pr_live ${REPO}#1601 staging`, data: { pr: `${REPO}#1601`, env: "staging", production: false, tag: "v1.4.0-1a2b3c4" } });
    const next: any = await O.call("studio_events", { since: ev.nextCursor });
    ok(next.data.events.length === 1 && next.data.events[0].type === "pr_live" && next.nextCursor !== ev.nextCursor, "a new event comes next, once");
    const byRef: any = await O.call("studio_events", { ref: `room:${ROOM}` }), byKind: any = await O.call("studio_events", { kinds: ["pr"] });
    ok(byRef.data.events.length === 1 && byRef.data.events[0].type === "room_round_failed" && byKind.data.events.every((e: any) => e.refs.some((r: string) => r.startsWith("pr:"))) && byKind.data.events.length === 4, "follow one ref, or one kind", J([byRef.data.events.length, byKind.data.events.length]));
    const bad = await failOf(() => O.call("studio_events", { kinds: ["nope"] }));
    ok(/Valid kinds/.test(bad?.en ?? ""), "an unknown kind names the valid ones");
    for (let i = 0; i < 120; i++) F.log.emit({ type: "terminal", workflow: "terminal", summary: `line ${i} ` + "x".repeat(200) });
    let cur = next.nextCursor, seen = 0, pages = 0; do { const pg: any = await O.call("studio_events", { since: cur }); ok(bytes(pg) <= BUDGET.summary, `events page ${pages + 1} within 4 KB`); seen += pg.data.events.length; pages++; if (!pg.data.more) break; cur = pg.nextCursor; } while (pages < 60);
    ok(seen === 120, "the cursor reads every new event once, page by page", `${seen} in ${pages}`); }

  // ---------- an audit line that names what a caller sent is untrusted (a grant's tool name is any text in a URL) ----------
  { F.log.emit({ type: "cli_grant_used", workflow: "cli-grant", actor: "external-cli", summary: `external CLI grant g-0000beef called ${INJECTION}`, data: { grant: "g-0000beef", tool: INJECTION } });
    F.log.emit({ type: "cli_grant_refused", workflow: "cli-grant", actor: "external-cli", summary: `external CLI call ${INJECTION} refused: unknown`, data: { grant: null, tool: INJECTION, why: "unknown" } });
    const ev: any = await O.call("studio_events", { since: "seq:0" }); let all: any[] = ev.data.events, cur = ev.nextCursor;
    while (ev.data.more) { const pg: any = await O.call("studio_events", { since: cur }); all = all.concat(pg.data.events); cur = pg.nextCursor; if (!pg.data.more) break; }
    const used = all.filter((e: any) => e.type === "cli_grant_used" || e.type === "cli_grant_refused");
    ok(used.length === 2 && used.every((e: any) => e.line?.untrusted === true && !("summary" in e)) && !bare(all).includes("IGNORE"), "cli_grant_used and cli_grant_refused name what the caller sent: untrusted, never at Studio's trust", J(used)); }

  // ---------- an artifact made by a withheld Task: its title and summaries are left out ----------
  { const tainted = F.E.start({ workflow: "deploy-fixture", version: 1, title: `ISSUE ART ${INJECTION}`, text: "x", by: "fixture", params: { _tainted: "issue-text" } } as any);
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const d = join(mkdtempSync(join(tmpdir(), "crew-obs-wart-")), "v1"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), "<p>x</p>");
    F.artifacts.create({ id: "issue-page", title: `ISSUE ART ${INJECTION}`, type: "web", source: "html", entry: "index.html" });
    F.artifacts.addVersion("issue-page", { from: d, primary: "index.html", createdBy: { kind: "agent", run: tainted.id }, status: "in-review", summary: `made from the issue ${INJECTION}` } as any);
    const got: any = await O.call("studio_get", { ref: "artifact:issue-page", depth: "full" }), mine: any = await O.call("studio_get", { ref: "artifact:harbor-banner" }), listed: any = await O.call("studio_list", { kind: "artifact" });
    ok(got.data.withheld && !("title" in got.data) && !J(got).includes("ISSUE ART") && !J(listed).includes("ISSUE ART") && mine.data.title?.untrusted === true, "an artifact of a withheld Task shows no title or summary; any other artifact's title is untrusted", J([got.data, mine.data.title]).slice(0, 400)); }

  // ---------- a script skill's hosts, warnings and reasons are its author's words ----------
  { const sk: any = await O.call("studio_get", { ref: "skill:baton" });
    ok(sk.data.packageText?.untrusted === true && !("hosts" in sk.data.package) && !("warnings" in sk.data.package) && !("reasons" in sk.data.package) && sk.data.package.decision.scripts === "approved", "an imported script skill's hosts, warnings and reasons come as untrusted", J(sk.data)); }

  { const base: any = await O.call("studio_logs", { ref: `pr:${REPO}#1601` }), from = base.nextCursor;
    for (let i = 0; i < 30; i++) F.log.emit({ type: "pr_live", workflow: "studio", summary: `pr_live ${REPO}#1601 env${i}`, data: { pr: `${REPO}#1601`, env: `env${i}`, production: false, tag: null } });
    const seen: string[] = []; let cur = from, pages = 0;
    do { const pg: any = await O.call("studio_logs", { ref: `pr:${REPO}#1601`, tail: 20, since: cur }); pages++; pg.data.events.forEach((e: any) => seen.push(e.data.env)); if (!pg.data.more) break; cur = pg.nextCursor; } while (pages < 10);
    ok(seen.length === 30 && new Set(seen).size === 30 && seen[0] === "env0" && pages >= 2, "a pull request's log: 30 new events with tail 20 come in two pages, oldest first, none lost", `${seen.length} in ${pages}`); }
  // ---------- withheld Tasks keep their words out of the logs and the events ----------
  { const tainted = F.E.start({ workflow: "deploy-fixture", version: 1, title: `ISSUE ${INJECTION}`, text: "x", by: "fixture", params: { _tainted: "issue-text" } } as any);
    const { until } = await import("./rt-harness"); await until(() => !!F.E.get(tainted.id)?.failure || F.E.get(tainted.id)?.status === "failed");
    F.log.emit({ type: "run_note", workflow: "studio", task: tainted.id, summary: `ISSUE LINE ${INJECTION}` });
    const lg: any = await O.call("studio_logs", { ref: `task:${tainted.id}` }), ev: any = await O.call("studio_events", { ref: `task:${tainted.id}` });
    ok(lg.data.withheld && !J(lg).includes("IGNORE") && !J(ev).includes("ISSUE LINE") && ev.data.events.length >= 1 && ev.data.events.every((e: any) => e.withheld), "a withheld Task's steps' errors and its events' lines are left out", J([lg.data, ev.data]).slice(0, 400)); }

  // ---------- the runtime: Firstmate gets the six tools; the screen only on the captain's own message naming it ----------
  { const { harness } = await import("./rt-harness"); const { createRuntime } = await import("../src/runtime/index"); const { join } = await import("node:path");
    const H2 = await harness([]), root = join(import.meta.dir, "..");
    try { const rt = createRuntime({ dataDir: H2.data, agents: H2.agents, provider: H2.engine.deps.provider, defaultProvider: () => ({ provider: "stub", model: null }), log: H2.engine.deps.log, send() {}, fmRoot: root, protectedRoots: [root], studioUrl: () => H2.toolUrl, observe: { terminals: () => F.terminals } } as any);
      const ref = `terminal:${F.terms[0].id}`, owner = (text: string, extra: any = {}) => ({ key: "k", captain: true, text, live: () => true, ...extra });
      const yes: any = await rt.firstmate.call("studio_logs", { ref }, owner("show me the terminal output"));
      const no: any = await rt.firstmate.call("studio_logs", { ref }, owner("which terminal is waiting?"));
      const card: any = await rt.firstmate.call("studio_logs", { ref }, owner("show me the terminal output", { captain: false }));
      const grant: any = await rt.firstmate.call("studio_logs", { ref }, owner("show me the terminal output", { origin: { grant: "g-00000000" } }));
      ok(yes.data.screen.shown === true && no.data.screen.shown === false && card.data.screen.shown === false && grant.data.screen.shown === false, "Firstmate's studio_logs: the screen on the captain's own message asking for it; never on a card, another question or a grant", J([yes.data.screen.shown, no.data.screen.shown, card.data.screen.shown, grant.data.screen.shown]));
      ok(["studio_logs", "studio_events"].every((n) => rt.firstmate.specs.some((x: any) => x.name === n)), "Firstmate's tool list has studio_logs and studio_events");
    } finally { H2.stop(); } }
} finally { for (const r of F.E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) { try { await F.E.cancel(r.id); } catch {} } F.H.stop(); }
end();
