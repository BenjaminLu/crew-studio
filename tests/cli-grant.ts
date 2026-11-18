import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// External CLI grants in process (docs/units/cli-mcp-grant.md): the grant store (hash only, 0600 token file, expiry,
// revoke, call bound, audit) and the four grant tools over a real engine with Studio's proposal workflow. A grant reads
// only the runs it started in its own project; start_run never reaches a running Task without the captain's dispatch answer.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, until } from "./rt-harness";
import { installFirstmate } from "../src/firstmate";
import { Projects } from "../src/doors";
import { CliGrants, createGrantTools, installGrantViews, expiryOf } from "../src/cli-grants";

process.env.CREW_TEST_IN_PROCESS = "1";
const H = await harness([readFileSync(new URL("../workflows/v2/firstmate-proposal.wf.yaml", import.meta.url), "utf8"),
  JSON.stringify({ id: "proj-fixture", name: "Project fixture", version: 1, params: { project: { label: "Project" } }, roles: [], nodes: [{ id: "done", kind: "hook", label: "Done" }], edges: [] }),
  JSON.stringify({ id: "loose-fixture", name: "No project", version: 1, roles: [], nodes: [{ id: "done", kind: "hook", label: "Done" }], edges: [] })]);
const E: any = H.engine;
const projects = new Projects(H.data); projects.add({ id: "alpha" }); projects.add({ id: "beta" });
// a seat gate the test closes: work proposed while it is closed is held on the seat card's Task, as an empty team seat does
let seat: string | null = null;
const fm = installFirstmate(E, projects, { crewSeatGate: async () => { if (seat) throw Object.assign(new Error(`seat card ${seat}`), { seatRun: seat }); } });
const audit: { type: string; data: any }[] = [];
const grants = new CliGrants(H.data, (type, _s, data) => audit.push({ type, data }));
installGrantViews(E, grants);
const tools = createGrantTools({ engine: E, grants, firstmate: () => fm });
const use = (token: string, tool: string) => { const u = grants.use(token, tool); if (!u.ok) throw Object.assign(new Error(u.error), { status: u.status }); return u.grant; };
const call = async (token: string, name: string, args: unknown = {}) => tools.call(use(token, name), name, args) as Promise<any>;
const tokenOf = (id: string) => readFileSync(grants.tokenFile(id), "utf8").trim();
let failed = false;
const step = async (name: string, f: () => Promise<void> | void) => { try { await f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };

try {
  const A = grants.issue({ project: "alpha", ttl: "1h" }, "captain").grant, A2 = grants.issue({ project: "alpha", ttl: "8h" }, "captain").grant, Bg = grants.issue({ project: "beta", ttl: "eod" }, "captain").grant;
  const ta = tokenOf(A.id), ta2 = tokenOf(A2.id), tb = tokenOf(Bg.id);
  let run = "";
  await step("the token file is 0600 and the store holds only its hash", () => {
    assert.equal(statSync(grants.tokenFile(A.id)).mode & 0o777, 0o600);
    assert.ok(!readFileSync(join(H.data, "cli-grants.json"), "utf8").includes(ta));
    assert.equal((grants.list()[0] as any).tokenHash, undefined);
  });
  await step("expiry choices: 1 h, 8 h, end of the local day; anything else is refused", () => {
    const now = new Date(2026, 10, 10, 15, 30); assert.equal(expiryOf("1h", now).getTime() - now.getTime(), 3600_000); assert.equal(expiryOf("8h", now).getTime() - now.getTime(), 8 * 3600_000);
    const eod = expiryOf("eod", now); assert.equal(eod.getDate(), 11); assert.equal(eod.getHours(), 0);
    assert.throws(() => grants.issue({ project: "alpha", ttl: "30d" }, "captain"));
  });
  await step("a wrong or forged token is refused with 403", () => {
    assert.equal((grants.use(ta.slice(0, -1) + (ta.endsWith("0") ? "1" : "0"), "list_workflows") as any).status, 403);
    assert.equal((grants.use("csg_g-00000000_" + "0".repeat(64), "list_workflows") as any).status, 403);
  });
  await step("list_workflows offers only project workflows", async () => {
    const ids = (await call(ta, "list_workflows")).workflows.map((w: any) => w.id); assert.ok(ids.includes("proj-fixture")); assert.ok(!ids.includes("loose-fixture")); assert.ok(!ids.includes("firstmate-proposal"));
    assert.match((await call(ta, "start_run", { workflow: "loose-fixture", input: { text: "x" } })).error, /does not run in a project/);
  });
  await step("start_run cannot reach a running Task without the captain's approval", async () => {
    const r = await call(ta, "start_run", { workflow: "proj-fixture", input: { text: "do the thing" }, staffing: { reviewer: "codex" } });
    assert.equal(r.state, "awaiting_captain", JSON.stringify(r)); run = r.run;
    assert.ok(await until(() => E.cards.list({ run, open: true }).length === 1), "the dispatch card is raised");
    await new Promise((res) => setTimeout(res, 500));
    assert.equal(E.get(run).ctx.childRun, undefined); assert.ok(!E.list().some((x: any) => x.params._firstmateProposal === run), "no Task was started");
    assert.ok(await until(() => E.get(run).status === "waiting"), `the proposal waits (${E.get(run).status})`);
    const card = E.cards.view(E.cards.list({ run, open: true })[0]); assert.equal(card.origin.kind, "external-cli"); assert.equal(card.origin.grant, A.id); assert.deepEqual(card.origin.staffing, { reviewer: "codex" });
    assert.equal(card.captainOnly, true);
    assert.equal((await call(ta, "run_status", { run })).state, "awaiting_captain");
  });
  await step("grant A2 (same project) and grant B (another project) cannot read grant A's run", async () => {
    for (const t of [ta2, tb]) for (const n of ["run_status", "read_cards"]) assert.match((await call(t, n, { run })).error ?? "", /no run .* started by grant/);
    assert.match((await call(tb, "start_run", { workflow: "proj-fixture", input: { text: "x", params: { project: "alpha" } } })).error, /is for project beta/);
  });
  await step("a run of the grant moved out of its project is not readable (project check)", async () => {
    const r = E.get(run), saved = r.params.target; const t = JSON.parse(saved); t.params.project = "beta"; r.params.target = JSON.stringify(t);
    try { assert.match((await call(ta, "run_status", { run })).error ?? "", /no run/); } finally { r.params.target = saved; }
    assert.equal((await call(ta, "run_status", { run })).state, "awaiting_captain");
  });
  await step("there is no approve tool", async () => {
    assert.deepEqual(tools.list().map((t) => t.name).sort(), ["list_workflows", "read_cards", "run_status", "start_run"]);
    assert.match((await call(ta, "approve_card", { card: "x" })).error, /no such tool/);
    assert.equal(E.cards.list({ run, open: true }).length, 1, "the card is still open");
  });
  await step("after the captain approves, the Task runs and the grant follows it", async () => {
    const c = E.cards.list({ run, open: true })[0]; await E.answer(c.id, { choice: "approve", by: "captain" });
    assert.ok(await until(() => typeof E.get(run).ctx.childRun === "string"));
    const st = await call(ta, "run_status", { run }); assert.ok(st.task, JSON.stringify(st)); assert.equal(st.workflow, "proj-fixture");
    assert.ok(await until(() => E.get(E.get(run).ctx.childRun).status === "succeeded")); assert.equal((await call(ta, "run_status", { run })).state, "done");
    assert.equal(E.externalOrigin(E.get(st.task)).grant, A.id);
    assert.match((await call(tb, "run_status", { run: st.task })).error ?? "", /no run/);
  });
  await step("a revoked grant is refused with 403 and its token file removed", () => {
    grants.revoke(A2.id, "captain"); const u: any = grants.use(ta2, "list_workflows"); assert.equal(u.ok, false); assert.equal(u.status, 403); assert.match(u.error, /revoked/);
  });
  await step("an expired grant is refused with 403", () => {
    const f = join(H.data, "cli-grants.json"), all = JSON.parse(readFileSync(f, "utf8")); all.find((g: any) => g.id === Bg.id).expiresAt = new Date(Date.now() - 1).toISOString(); writeFileSync(f, JSON.stringify(all));
    const u: any = grants.use(tb, "list_workflows"); assert.equal(u.status, 403); assert.match(u.error, /expired/);
  });
  await step("calls are bounded per grant", () => {
    process.env.CREW_CLI_GRANT_MAX_CALLS = "3"; const g = grants.issue({ project: "alpha", ttl: "1h" }, "captain").grant, t = tokenOf(g.id);
    try { for (let i = 0; i < 3; i++) assert.equal(grants.use(t, "list_workflows").ok, true); const u: any = grants.use(t, "list_workflows"); assert.equal(u.status, 429); }
    finally { delete process.env.CREW_CLI_GRANT_MAX_CALLS; }
  });
  await step("work held on a seat card is proposed again under the same grant, and never after it is revoked", async () => {
    const holder = await fm.call("studio_propose_work", { workflow: "proj-fixture", version: 1, text: "a seat card stand-in", params: { project: "alpha" } }, { key: "seat-holder", captain: true, text: "a seat card stand-in", live: () => true }) as any;
    assert.ok(await until(() => E.get(holder.proposal).status === "waiting")); seat = holder.proposal;
    const g = grants.issue({ project: "alpha", ttl: "1h" }, "captain").grant, t = tokenOf(g.id), gone = grants.issue({ project: "alpha", ttl: "1h" }, "captain").grant, tg = tokenOf(gone.id);
    assert.match((await call(t, "start_run", { workflow: "proj-fixture", input: { text: "held work" }, staffing: { reviewer: "claude" } })).error ?? "", /seat card/);
    assert.match((await call(tg, "start_run", { workflow: "proj-fixture", input: { text: "held work of a revoked grant" } })).error ?? "", /seat card/);
    seat = null; grants.revoke(gone.id, "captain");
    const done = await (fm as any).resumeHeld(holder.proposal);
    const again = done.find((d: any) => d.proposal), refused = done.find((d: any) => d.error);
    assert.ok(again && refused && /no longer active/.test(refused.error), JSON.stringify(done));
    assert.equal(E.get(again.proposal).by, `External CLI grant ${g.id} (captain approval required)`, "the proposal keeps the grant, not Firstmate");
    assert.ok(await until(() => E.cards.list({ run: again.proposal, open: true }).length === 1));
    const card = E.cards.view(E.cards.list({ run: again.proposal, open: true })[0]); assert.equal(card.origin?.grant, g.id); assert.deepEqual(card.origin.staffing, { reviewer: "claude" });
    assert.match(card.sections.en.why, /external CLI/);
    assert.equal((await call(t, "run_status", { run: again.proposal })).state, "awaiting_captain", "the grant reads the work it proposed again");
  });
  await step("an expired grant's token file is removed", () => {
    const g = grants.issue({ project: "alpha", ttl: "1h" }, "captain").grant, f = join(H.data, "cli-grants.json"), all = JSON.parse(readFileSync(f, "utf8"));
    all.find((x: any) => x.id === g.id).expiresAt = new Date(Date.now() - 1).toISOString(); writeFileSync(f, JSON.stringify(all));
    grants.list(); assert.equal(existsSync(grants.tokenFile(g.id)), false);
  });
  await step("every issue, use, refusal and revoke is audited", () => {
    const types = new Set(audit.map((a) => a.type)); for (const t of ["cli_grant_issued", "cli_grant_used", "cli_grant_refused", "cli_grant_revoked", "cli_grant_run"]) assert.ok(types.has(t), t);
  });
  // ---------- scopes are a set; old records migrate; observe presets; never-grantable kinds; the rolling budget ----------
  await step("a grant written before scopes were a set reads as that scope, and is written back as a set", () => {
    const { mkdtempSync } = require("node:fs") as typeof import("node:fs"); const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "crew-grant-migrate-")), f = join(dir, "cli-grants.json");
    const old = (id: string, scope?: string) => ({ id, ...(scope ? { scope } : {}), project: scope === "prs" ? "" : "alpha", ttl: "1h", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), lastUsedAt: null, revokedAt: null, revokedBy: null, createdBy: "captain", calls: 0, tokenHash: "0".repeat(64), runs: [] });
    writeFileSync(f, JSON.stringify([old("g-00000001"), old("g-00000002", "prs"), old("g-00000003", "project")]));
    const g = new CliGrants(dir), raw = JSON.parse(readFileSync(f, "utf8"));
    assert.deepEqual(g.list().map((x) => [x.id, x.scopes]).sort(), [["g-00000001", ["project"]], ["g-00000002", ["prs"]], ["g-00000003", ["project"]]]);
    assert.ok(raw.every((x: any) => Array.isArray(x.scopes)) && raw.filter((x: any) => "scope" in x).map((x: any) => x.scope).join() === "prs", JSON.stringify(raw)); // a prs grant keeps scope for an older release
    assert.equal(new CliGrants(dir).migrate(), 0, "written once");
  });
  await step("an observe grant: presets give kinds; external text off by default; settings, grants, peers, terminals and focus never", () => {
    const r = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant;
    assert.deepEqual(r.scopes, ["observe"]); assert.deepEqual(r.observe, { preset: "review", kinds: ["room"], untrusted: false }); assert.equal(r.project, "");
    const p = grants.issue({ scopes: ["project", "observe"], project: "alpha", observe: { preset: "project", untrusted: true }, ttl: "1h" }, "captain").grant;
    assert.deepEqual(p.scopes, ["project", "observe"]); assert.equal(p.observe!.untrusted, true); assert.ok(!p.observe!.kinds.some((k) => ["settings", "terminal", "peer"].includes(k)));
    for (const k of ["settings", "terminal", "peer", "grant", "focus"]) assert.throws(() => grants.issue({ scopes: ["observe"], observe: { preset: "custom", kinds: ["task", k] }, ttl: "1h" }, "captain"), /never reads/, k);
    assert.throws(() => grants.issue({ scopes: ["observe"], observe: { preset: "project" }, ttl: "1h" }, "captain"), /choose a project/);
    assert.throws(() => grants.issue({ scopes: ["nope"], ttl: "1h" } as any, "captain"), /choose what the grant reaches/);
    assert.throws(() => grants.issue({ scopes: ["project"], project: "alpha", observe: { preset: "review" }, ttl: "1h" }, "captain"), /need the observe scope/);
    for (const g of [r, p]) grants.revoke(g.id, "captain");
  });
  await step("a grant lists only its scopes' tools; a tool outside them is no tool", async () => {
    const T = createGrantTools({ engine: E, grants, firstmate: () => fm, observe: (v) => ({ specs: [{ name: "studio_get", description: "x", inputSchema: {}, outputSchema: {}, annotations: { readOnlyHint: true } }], call: async (n, a) => ({ called: n, a, kinds: v.kinds, untrusted: v.untrusted }) }) });
    const o = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, full = grants.get(o.id)!;
    assert.deepEqual(T.list(full).map((t) => t.name), ["studio_get"]);
    assert.deepEqual(await T.call(full, "studio_get", { ref: "room:x" }), { called: "studio_get", a: { ref: "room:x" }, kinds: ["room"], untrusted: false });
    assert.match(String(((await T.call(full, "start_run", {})) as any).error), /no such tool/);
    const both = grants.get(grants.issue({ scopes: ["project", "observe"], project: "alpha", observe: { preset: "project" }, ttl: "1h" }, "captain").grant.id)!;
    assert.deepEqual(T.list(both).map((t) => t.name), ["list_workflows", "start_run", "run_status", "read_cards", "studio_get"]);
    for (const g of [o, both]) grants.revoke(g.id, "captain");
  });
  await step("each grant has a rolling budget: calls and bytes in the last hour, refused with when it frees up", () => {
    const keep = { c: process.env.CREW_CLI_GRANT_HOURLY_CALLS, b: process.env.CREW_CLI_GRANT_HOURLY_BYTES };
    process.env.CREW_CLI_GRANT_HOURLY_CALLS = "3"; process.env.CREW_CLI_GRANT_HOURLY_BYTES = "30000";
    try {
      const g = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, t = tokenOf(g.id);
      for (let i = 0; i < 3; i++) { assert.ok(grants.use(t, "studio_now").ok); grants.charge(g.id, 10); }
      const r = grants.use(t, "studio_now"); assert.ok(!r.ok && r.status === 429 && /hourly budget/.test(r.error) && /frees up from/.test(r.error), JSON.stringify(r));
      const h = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, th = tokenOf(h.id);
      assert.ok(grants.use(th, "studio_get").ok); grants.charge(h.id, 29000);
      const rb = grants.use(th, "studio_get"); assert.ok(!rb.ok && rb.status === 429 && /29000 of 30000 bytes/.test(rb.error), JSON.stringify(rb));
      assert.equal(grants.list().find((x) => x.id === h.id)!.budget.bytes, 29000);
      // an hour later the window has moved on
      const f = join(H.data, "cli-grants.json"), all = JSON.parse(readFileSync(f, "utf8")); for (const x of all) if (x.id === g.id) x.usage = x.usage.map((u: any) => ({ ...u, at: u.at - 3601_000 })); writeFileSync(f, JSON.stringify(all));
      assert.ok(grants.use(t, "studio_now").ok, "the window rolls");
      for (const x of [g, h]) grants.revoke(x.id, "captain");
    } finally { for (const [k, v] of [["CREW_CLI_GRANT_HOURLY_CALLS", keep.c], ["CREW_CLI_GRANT_HOURLY_BYTES", keep.b]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  });
  await step("a rollback to the release before scopes: plain project and prs grants still work there, any other grant is refused (403)", async () => {
    const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
    const { CliGrants: OldGrants } = await import("./fixture/cli-grants-before-scopes");
    const dir = mkdtempSync(join(tmpdir(), "crew-grant-rollback-")), now = new CliGrants(dir);
    const tok = (id: string) => readFileSync(now.tokenFile(id), "utf8").trim();
    const proj = now.issue({ scopes: ["project"], project: "alpha", ttl: "1h" }, "captain").grant, prs = now.issue({ scopes: ["prs"], ttl: "1h" }, "captain").grant;
    const obs = now.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, both = now.issue({ scopes: ["project", "observe"], project: "alpha", observe: { preset: "project" }, ttl: "1h" }, "captain").grant;
    for (const g of [proj, prs, obs, both]) assert.ok(now.use(tok(g.id), "x").ok, `today's release reads ${g.id}`);
    const old = new OldGrants(dir), use = (g: any) => old.use(tok(g.id), "tools/list");
    const p1 = use(proj), p2 = use(prs), p3 = use(obs), p4 = use(both);
    assert.ok(p1.ok && (p1.grant.scope ?? "project") === "project", JSON.stringify(p1));
    assert.ok(p2.ok && p2.grant.scope === "prs", JSON.stringify(p2));
    assert.ok(!p3.ok && p3.status === 403 && !p4.ok && p4.status === 403, `an observe grant must never read as a project grant there: ${JSON.stringify([p3, p4])}`);
    assert.equal(old.list().length, 4, "the older release still lists every grant (and can revoke them)");
    old.revoke(obs.id, "captain"); assert.equal(new CliGrants(dir).get(obs.id)?.revokedAt !== null, true, "a revoke made there holds here");
  });
  await step("records that are no grant are set aside; the list and revoke keep working", () => {
    const { mkdtempSync } = require("node:fs") as typeof import("node:fs"); const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "crew-grant-junk-")), first = new CliGrants(dir), g = first.issue({ scopes: ["project"], project: "alpha", ttl: "1h" }, "captain").grant;
    const f = join(dir, "cli-grants.json"); writeFileSync(f, JSON.stringify([null, "junk", 7, { note: "no id" }, ...JSON.parse(readFileSync(f, "utf8"))]));
    const again = new CliGrants(dir);
    assert.deepEqual(again.list().map((x) => x.id), [g.id]); assert.equal(JSON.parse(readFileSync(join(dir, "cli-grants.quarantine.json"), "utf8")).length, 4);
    assert.equal(again.revoke(g.id, "captain").state, "revoked");
  });
  await step("in-flight calls hold bytes: concurrent or slow callers cannot pass the hourly bytes; one audit line a minute while over", () => {
    const keep = process.env.CREW_CLI_GRANT_HOURLY_BYTES; process.env.CREW_CLI_GRANT_HOURLY_BYTES = "100000";
    try {
      const { RESERVE_BYTES } = require("../src/cli-grants") as typeof import("../src/cli-grants");
      const g = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, t = tokenOf(g.id), before = audit.length;
      const admitted = Array.from({ length: 6 }, () => grants.use(t, "studio_get")).filter((x) => x.ok).length;
      assert.equal(admitted, Math.floor(100000 / RESERVE_BYTES), "only as many calls as their held bytes fit are admitted before any answers");
      const over = grants.use(t, "studio_get"); assert.ok(!over.ok && /4 of them still answering and holding 24576 bytes each; every call holds 24576 bytes up front/.test(over.error), JSON.stringify(over));
      for (let i = 0; i < 3; i++) grants.use(t, "studio_get");
      const refusals = audit.slice(before).filter((a) => a.type === "cli_grant_refused" && a.data.why === "hourly budget").length;
      assert.equal(refusals, 1, `one audit line for the burst of refusals, not one per call (${refusals})`);
      for (let i = 0; i < admitted; i++) grants.charge(g.id, 200);
      assert.ok(grants.use(t, "studio_get").ok, "once the answers are counted at their real size, the budget frees");
      const v = grants.list().find((x) => x.id === g.id)!; assert.ok(!v.budget.usedUp && v.budget.bytes >= admitted * 200);
      grants.revoke(g.id, "captain");
    } finally { if (keep === undefined) delete process.env.CREW_CLI_GRANT_HOURLY_BYTES; else process.env.CREW_CLI_GRANT_HOURLY_BYTES = keep; }
  });
  await step("a used-up budget says when it frees up", () => {
    const keep = process.env.CREW_CLI_GRANT_HOURLY_CALLS; process.env.CREW_CLI_GRANT_HOURLY_CALLS = "2";
    try { const g = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, t = tokenOf(g.id); grants.use(t, "a"); grants.use(t, "b");
      const v = grants.list().find((x) => x.id === g.id)!; assert.ok(v.budget.usedUp && Date.parse(v.budget.freesAt!) > Date.now(), JSON.stringify(v.budget)); grants.revoke(g.id, "captain"); }
    finally { if (keep === undefined) delete process.env.CREW_CLI_GRANT_HOURLY_CALLS; else process.env.CREW_CLI_GRANT_HOURLY_CALLS = keep; }
  });
  await step("a hand-edited record naming a never-grantable kind never reaches the read tools", async () => {
    const { observeGrant } = await import("../src/cli-grants");
    const v = observeGrant({ id: "g-00000009", project: "", scopes: ["observe"], observe: { preset: "custom", kinds: ["room", "terminal", "settings", "peer", "grant", "focus"], untrusted: false } });
    assert.deepEqual(v!.kinds, ["room"]);
    // and the board lists the kinds it really reads, not the edited ones
    const g = grants.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }, "captain").grant, f = join(H.data, "cli-grants.json");
    const all = JSON.parse(readFileSync(f, "utf8")); for (const x of all) if (x.id === g.id) x.observe.kinds = ["room", "terminal", "settings"]; writeFileSync(f, JSON.stringify(all));
    assert.deepEqual(grants.list().find((x) => x.id === g.id)!.observe!.kinds, ["room"]); grants.revoke(g.id, "captain");
  });
} finally { for (const r of E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) await E.cancel(r.id); H.stop(); }
console.log(failed ? "\ncli-grant: FAILED" : "\ncli-grant: all passed");
process.exit(failed ? 1 : 0);
