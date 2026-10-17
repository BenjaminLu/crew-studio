// Three Studio runs in parallel, shaped like the runtime's own /api/wruns, /api/wruns/<id> and
// /api/scards answers (src/runtime/index.ts): R-101 in build round 2, R-102 waiting on its merge
// card, R-103 failed at CI. The definition is code-firstmate v2 as the runtime serves it.
// Used by tests/board-ui.mjs (served through Playwright routes) and for the Board screenshots.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const def = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "code-firstmate.def.json"), "utf8"));

export function boardFixture(now = Date.now()) {
  const at = (min) => new Date(now - min * 60000).toISOString();
  const blank = () => Object.fromEntries(def.nodes.map((n) => [n.id, { state: "pending", visits: 0, extra: 0, attempt: 0, outcome: null, cause: null, error: null, startedAt: null, endedAt: null, inbox: [], agent: null, swap: null, job: null, card: null, waiting: null, data: {}, note: null }]));
  const pass = (nodes, id, o = {}) => Object.assign(nodes[id], { state: "passed", visits: 1, outcome: "ok" }, o);
  const job = (id, round, provider, model, usd) => ({ id, round, hop: 0, provider, model, status: "done", cost: usd == null ? null : { usd, inTokens: 20000, outTokens: 2000 }, tools: 12, error: null });
  const step = (seq, node, kind, state, min, o = {}) => ({ seq, node, kind, visit: 1, state, outcome: state === "passed" ? "ok" : null, startedAt: at(min), endedAt: state === "running" || state === "waiting" ? null : at(min - 1), error: null, job: null, provider: null, model: null, note: null, ...o });
  const base = (nodes) => { for (const id of ["intake", "prepare", "dispatch", "door"]) pass(nodes, id);
    pass(nodes, "spec", { startedAt: at(40), endedAt: at(38), data: { jobs: [job("J-spec", 1, "claude", "claude-opus-5-5", 0.42)] } }); pass(nodes, "spec-fix"); return nodes; };

  // R-101: build round 2 running (round 1: build, ci and review passed, the fix loop sent it back)
  const n1 = base(blank());
  Object.assign(n1.build, { state: "running", visits: 2, agent: { provider: "codex", model: "gpt-5.5" }, startedAt: at(6), data: { jobs: [job("J-b1", 1, "codex", "gpt-5.5", 0.88)] } });
  pass(n1, "ci"); pass(n1, "review", { data: { jobs: [job("J-r1", 1, "claude", "claude-opus-5-5", 0.21)] } }); pass(n1, "fix", { outcome: "again" });
  const s1 = [step(1, "spec", "agent", "passed", 40, { job: "J-spec", provider: "claude", model: "claude-opus-5-5" }), step(2, "build", "agent", "passed", 30, { job: "J-b1", provider: "codex", model: "gpt-5.5" }),
    step(3, "review", "agent", "passed", 20, { job: "J-r1", provider: "claude", model: "claude-opus-5-5" }), step(4, "build", "agent", "running", 6, { visit: 2, provider: "codex", model: "gpt-5.5" })];

  // R-102: everything up to the merge card passed; the merge card waits on the captain
  const n2 = base(blank());
  pass(n2, "build", { data: { jobs: [job("J-b2", 1, "claude", "claude-opus-5-5", 1.1)] } }); pass(n2, "ci"); pass(n2, "review", { data: { jobs: [job("J-r2", 1, "codex", "gpt-5.5", 0.3)] } });
  Object.assign(n2["merge-card"], { state: "running", visits: 1, waiting: "card", card: "SC-201", startedAt: at(12) });
  const s2 = [step(1, "build", "agent", "passed", 30, { job: "J-b2" }), step(2, "review", "agent", "passed", 20, { job: "J-r2" }), step(3, "merge-card", "card", "waiting", 12)];

  // R-103: CI failed; the run failed
  const n3 = base(blank());
  pass(n3, "build", { data: { jobs: [job("J-b3", 1, "claude", "claude-sonnet-5-5", 0.35)] } });
  Object.assign(n3.ci, { state: "failed", visits: 1, outcome: "fail", error: "2 of 14 tests fail (test/round.test.ts)" });
  const s3 = [step(1, "build", "agent", "passed", 25, { job: "J-b3" }), step(2, "ci", "check", "failed", 22)];

  // R-104: the door check said one-way; the door card waits on the captain
  const n4 = base(blank());
  Object.assign(n4["door-pick"], { state: "running", visits: 1, waiting: "card", card: "SC-202", startedAt: at(4) });
  n4.door = { ...n4.door, outcome: "one-way" };
  const s4 = [step(1, "door", "check", "passed", 6), step(2, "door-pick", "card", "waiting", 4)];

  const card = (id, run, node, kind, title, why, options, o = {}) => ({ id, run, node, visit: 1, kind, title: { en: title, "zh-TW": title }, sections: { en: { intent: title, why }, "zh-TW": { intent: title, why } },
    body: `Intent: ${title}\n\n${why}`, options, confirmDoor: true, door: "two-way", links: [], workflow: "code-firstmate", runTitle: o.runTitle, status: "open", createdAt: at(12), answer: null, ...o });
  const SC201 = card("SC-201", "R-102", "merge-card", "merge", "Merge: format() supports JPY, a currency without cents",
    "Some currencies have no minor unit, so 1235 yen comes out as \"$12.35\". The six gates passed on this head.",
    [{ id: "merge", label: "Merge", primary: true }, { id: "changes", label: "Request changes", note: true, hold: true }, { id: "close", label: "Close without merging", hold: true }], { runTitle: "Format zero-decimal currencies" });

  const SC202 = card("SC-202", "R-104", "door-pick", "question", "Door: the price table migration is one-way",
    "It renames a column that other services read. A revert will not bring their reads back.",
    [{ id: "approve", label: "Go one-way", primary: true }, { id: "changes", label: "Request changes", note: true, hold: true }], { door: "one-way", runTitle: "Migrate the price table", createdAt: at(4) });

  const run = (id, title, status, nodes, steps, min, o = {}) => ({ id, workflow: "code-firstmate", version: 2, def, title, text: title, params: {}, by: "captain", status, result: null, createdAt: at(min), updatedAt: o.endedAt ?? at(1),
    endedAt: o.endedAt ?? null, error: o.error ?? null, nodes, queue: [], steps, ctx: {}, classifier: null, events: [], recovered: 0, cards: o.cards ?? [], ledger: [], ledgerOk: true, done: [] });
  const details = {
    "R-101": run("R-101", "Add a percent function to money-kit", "running", n1, s1, 45),
    "R-102": run("R-102", "Format zero-decimal currencies", "waiting", n2, s2, 52, { cards: [SC201] }),
    "R-103": run("R-103", "Round half to even in format()", "failed", n3, s3, 30, { endedAt: at(21), error: "CI failed: 2 of 14 tests fail (test/round.test.ts)" }),
    "R-104": run("R-104", "Migrate the price table", "waiting", n4, s4, 8, { cards: [SC202] }),
    // finished today: not in flight, off the Board, but its spend is today's
    "R-091": (() => { const n = base(blank()); for (const k of ["build", "ci", "review", "merge-card", "merge", "after-merge", "cleanup", "done"]) pass(n, k);
      n.build.data = { jobs: [job("J-b9", 1, "claude", "claude-opus-5-5", 1.0)] }; n.spec.data = { jobs: [] };
      return run("R-091", "Merged this morning", "succeeded", n, [step(1, "build", "agent", "passed", 20, { job: "J-b9" })], 25, { endedAt: at(10) }); })(),
    // finished long ago: not in flight, never on the Board
    "R-090": (() => { const n = base(blank()); Object.assign(n.spec, { startedAt: at(60 * 50), endedAt: at(60 * 50 - 2) }); return run("R-090", "Old merged change", "succeeded", n, [], 60 * 50, { endedAt: at(60 * 49) }); })(),
  };
  const open = [SC201, SC202]; let answerCalls = 0;
  const list = () => ({ runs: Object.values(details).map((r) => ({ id: r.id, workflow: r.workflow, version: r.version, title: r.title, status: r.status, result: r.result, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt, error: r.error,
    current: Object.entries(r.nodes).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => ({ node: k, state: n.state })), door: "two-way", recovered: 0 })), cards: open.filter((c) => c.status === "open") });
  // the runtime's own answer rules (src/runtime/cards.ts): a note when the option asks for one; the door when one-way
  const answer = (id, b) => { answerCalls++;
    const c = open.find((x) => x.id === id); if (!c) return [400, { error: "no such card" }];
    if (c.status !== "open") return [400, { error: `this card is ${c.status}: a card is answered exactly once` }];
    const opt = c.options.find((o) => o.id === b.choice); if (!opt) return [400, { error: `choose one of ${c.options.map((o) => o.id).join(", ")}` }];
    if (opt.note && !String(b.note ?? "").trim()) return [400, { error: "say what to change" }];
    if (c.confirmDoor && c.door === "one-way" && !opt.hold && b.confirm !== "one-way") return [400, { error: "a one-way change cannot be undone by a revert: confirm the door first" }];
    c.status = "answered"; c.answer = { choice: b.choice, note: b.note ?? null, by: "captain (desktop)", at: new Date().toISOString(), confirm: b.confirm ?? null };
    return [200, c];
  };
  // the agent node runs working now, as the runtime's /api/wruns/agents reads them off its runs (src/runtime/index.ts): read
  // from the details at request time, so a test that moves a run on moves its crew too
  const agents = () => ({ agents: Object.values(details).filter((r) => !["succeeded", "failed", "cancelled"].includes(r.status)).flatMap((r) => Object.entries(r.nodes)
    .filter(([id, n]) => n.state === "running" && n.agent && def.nodes.find((x) => x.id === id)?.kind === "agent").map(([id, n]) => { const d = def.nodes.find((x) => x.id === id);
      return { job: `J-${r.id}-${id}-${n.visits}`, run: r.id, runTitle: r.title, workflow: r.workflow, node: id, label: d.label ?? id, role: d.role ?? null, provider: n.agent.provider, model: n.agent.model,
        round: n.visits, attempt: n.attempt, startedAt: n.startedAt, tools: 0, lastActivity: null }; })), localJobs: [] });
  return { def, details, open, list, answer, agents, calls: () => answerCalls, policies: { org: { round_cap: 3 }, projects: [] } };
}

/** Serve the fixture on a Playwright context or page: the Studio run and card routes only; everything else goes to the real server. */
export async function routeBoardFixture(target, fx) {
  await target.route(/\/api\/(wruns|scards|policies)(\/|\?|$)/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname;
    const send = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/wruns" && req.method() === "GET") return send(200, fx.list());
    if (p === "/api/wruns/agents" && req.method() === "GET") return send(200, fx.agents());
    let m = /^\/api\/wruns\/(R-\d+)$/.exec(p); if (m) return fx.details[m[1]] ? send(200, fx.details[m[1]]) : send(404, { error: "no such run" });
    if (p === "/api/scards") return send(200, { cards: u.searchParams.get("open") === "1" ? fx.open.filter((c) => c.status === "open") : fx.open });
    m = /^\/api\/scards\/(SC-\d+)$/.exec(p); if (m && req.method() === "GET") { const c = fx.open.find((x) => x.id === m[1]); return c ? send(200, c) : send(404, { error: "no such card" }); }
    m = /^\/api\/scards\/(SC-\d+)\/answer$/.exec(p); if (m && req.method() === "POST") { await new Promise((r) => setTimeout(r, 400)); const [s, b] = fx.answer(m[1], JSON.parse(req.postData() || "{}")); return send(s, b); }
    if (p === "/api/policies") return send(200, fx.policies);
    return route.continue();
  });
}
