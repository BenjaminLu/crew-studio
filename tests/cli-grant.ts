import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// External CLI grants in process (docs/units/cli-mcp-grant.md): the grant store (hash only, 0600 token file, expiry,
// revoke, call bound, audit) and the four grant tools over a real engine with Studio's proposal workflow. A grant reads
// only the runs it started in its own project; start_run never reaches a running Task without the captain's dispatch answer.
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
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
const fm = installFirstmate(E, projects, {});
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
    assert.equal(E.get(run).status, "waiting");
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
  await step("every issue, use, refusal and revoke is audited", () => {
    const types = new Set(audit.map((a) => a.type)); for (const t of ["cli_grant_issued", "cli_grant_used", "cli_grant_refused", "cli_grant_revoked", "cli_grant_run"]) assert.ok(types.has(t), t);
  });
} finally { for (const r of E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) await E.cancel(r.id); H.stop(); }
console.log(failed ? "\ncli-grant: FAILED" : "\ncli-grant: all passed");
process.exit(failed ? 1 : 0);
