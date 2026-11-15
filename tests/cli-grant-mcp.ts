import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// External CLI grants end to end (docs/units/cli-mcp-grant.md), against a real Studio on a free port with temporary data:
// the board issues a grant (its page session, same origin; never a tool token or a script's header), the token lands in a
// 0600 file, `bun src/mcp.ts --grant-file <file>` speaks MCP over stdio with exactly four tools, start_run creates a
// proposal that waits for the captain's dispatch card (no work starts until the captain answers it on the board), a second
// grant cannot read the first one's run, there is no approve tool, and a revoked or expired grant gets HTTP 403.
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { staffedCodeStudio } from "./lib/staffed-code-studio";
import { sessionCookieName } from "../src/csrf";

const REPO = join(import.meta.dir, "..");
const s = await staffedCodeStudio("cli-grant");
const page = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", cookie: `${sessionCookieName(s.token)}=${s.token}`, "sec-fetch-site": "same-origin", origin: s.base, ...extra });
const post = async (path: string, body: unknown, headers: Record<string, string>) => { const r = await fetch(s.base + path, { method: "POST", headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

/** one MCP helper process over stdio, the way `claude mcp add studio -- …` starts it */
function mcp(file: string) {
  const p = spawn("bun", ["src/mcp.ts", "--grant-file", file, "--url", s.base], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map<number, (v: any) => void>(); let n = 0, err = "";
  p.stderr.on("data", (b) => { err += b; });
  createInterface({ input: p.stdout }).on("line", (l) => { try { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch {} });
  const rpc = (method: string, params?: unknown) => new Promise<any>((res, rej) => { const id = ++n; waiting.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); setTimeout(() => rej(new Error(`no answer to ${method}: ${err}`)), 20_000); });
  const tool = async (name: string, args: unknown = {}) => { const m = await rpc("tools/call", { name, arguments: args }); const text = m.result?.content?.[0]?.text ?? ""; let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; } return { isError: !!m.result?.isError, body, text }; };
  return { rpc, tool, close: () => p.kill() };
}

let failed = false;
const step = async (name: string, f: () => Promise<void>) => { try { await f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
try {
  let A: any, B: any;
  await step("issuing a grant refuses a tool token, a script's session header, a missing Origin and another site", async () => {
    const asScript = await post("/api/cli-grants", { project: "sandbox", ttl: "1h" }, { "content-type": "application/json", "x-crew-session": s.token });
    assert.equal(asScript.status, 403, JSON.stringify(asScript.body)); assert.equal(asScript.body.code, "captainOnly");
    const noOrigin = await post("/api/cli-grants", { project: "sandbox", ttl: "1h" }, (({ origin: _o, ...h }) => h)(page()));
    assert.equal(noOrigin.status, 403); assert.equal(noOrigin.body.code, "captainOnly");
    const noFetchSite = await post("/api/cli-grants", { project: "sandbox", ttl: "1h" }, (({ "sec-fetch-site": _f, ...h }) => h)(page()));
    assert.equal(noFetchSite.status, 403);
    const crossSite = await post("/api/cli-grants", { project: "sandbox", ttl: "1h" }, page({ origin: "http://evil.example" }));
    assert.equal(crossSite.status, 403);
    const noSession = await post("/api/cli-grants", { project: "sandbox", ttl: "1h" }, { "content-type": "application/json", origin: s.base, "sec-fetch-site": "same-origin" });
    assert.equal(noSession.status, 403);
    assert.ok(!existsSync(join(s.data, "cli-grants.json")) || JSON.parse(readFileSync(join(s.data, "cli-grants.json"), "utf8")).length === 0, "no grant was issued by a refused request");
  });
  await step("the board issues a grant: the token in a 0600 file under the data folder, only its hash stored, the copy-able command", async () => {
    const r = await post("/api/cli-grants", { project: "sandbox", ttl: "1h" }, page()); assert.equal(r.status, 200, JSON.stringify(r.body)); A = r.body.grant;
    assert.match(A.id, /^g-[0-9a-f]{8}$/); assert.equal(A.project, "sandbox"); assert.equal(A.state, "active"); assert.equal(A.file, join(s.data, "grants", A.id));
    assert.equal(statSync(A.file).mode & 0o777, 0o600, "token file is 0600"); assert.equal(statSync(join(s.data, "grants")).mode & 0o777, 0o700);
    const token = readFileSync(A.file, "utf8").trim(); assert.match(token, /^csg_g-[0-9a-f]{8}_[0-9a-f]{64}$/);
    assert.ok(!readFileSync(join(s.data, "cli-grants.json"), "utf8").includes(token), "the store keeps only a hash"); assert.equal(A.tokenHash, undefined);
    assert.match(A.claudeMcpAdd, /^claude mcp add studio -- \S+ \S*src\/mcp\.ts --grant-file \S+ --url http:\/\/127\.0\.0\.1:\d+$/); assert.ok(!A.claudeMcpAdd.includes(token), "the token is never on the command line");
    const asTool = await post("/api/cli-grants", { project: "sandbox", ttl: "8h" }, { "content-type": "application/json", "x-crew-tool-token": token, origin: s.base, "sec-fetch-site": "same-origin" });
    assert.equal(asTool.status, 403, "a grant token cannot issue a grant");
    const asToolWithPage = await post("/api/cli-grants", { project: "sandbox", ttl: "8h" }, page({ "x-crew-tool-token": token }));
    assert.equal(asToolWithPage.status, 403, "a request carrying a tool token is refused even with the page session");
    const bad = await post("/api/cli-grants", { project: "nope", ttl: "1h" }, page()); assert.equal(bad.status, 404);
    const badTtl = await post("/api/cli-grants", { project: "sandbox", ttl: "forever" }, page()); assert.equal(badTtl.status, 400);
    B = (await post("/api/cli-grants", { project: "sandbox", ttl: "eod" }, page())).body.grant; assert.ok(B?.id && B.id !== A.id);
  });
  const a = mcp(A.file), b = mcp(B.file); let run = "";
  await step("crew-studio mcp --grant-file speaks MCP with exactly four tools", async () => {
    const init = await a.rpc("initialize", { protocolVersion: "2025-06-18" }); assert.equal(init.result.serverInfo.name, "studio");
    const list = await a.rpc("tools/list"); assert.deepEqual(list.result.tools.map((t: any) => t.name).sort(), ["list_workflows", "read_cards", "run_status", "start_run"]);
    const wf = await a.tool("list_workflows"); assert.ok(!wf.isError, wf.text); assert.ok(wf.body.workflows.some((w: any) => w.id === "code-firstmate"), wf.text);
    assert.ok(wf.body.workflows.every((w: any) => !String(w.id).startsWith("firstmate-")), "Studio's own proposal workflows are not offered");
  });
  await step("start_run creates a proposal that waits for the captain: no work starts on its own", async () => {
    const r = await a.tool("start_run", { workflow: "code-firstmate", input: { text: "Add a line to the README saying hello", title: "README hello" }, staffing: { reviewer: "codex" } });
    assert.ok(!r.isError && !r.body.error, r.text); assert.equal(r.body.state, "awaiting_captain"); assert.equal(r.body.waiting_on, "dispatch"); run = r.body.run;
    const outsider = await a.tool("start_run", { workflow: "code-firstmate", input: { text: "x", params: { project: "other" } } }); assert.match(outsider.body.error ?? "", /is for project sandbox/);
    await Bun.sleep(1500);
    const runs = (await s.api("/api/wruns")).body.runs; const mine = runs.find((x: any) => x.id === run);
    assert.equal(mine.origin?.kind, "external-cli"); assert.equal(mine.origin?.grant, A.id); assert.deepEqual(mine.origin?.staffing, { reviewer: "codex" });
    assert.ok(!runs.some((x: any) => x.childRun === null && x.id !== run && x.origin?.grant === A.id && x.status === "running"), "nothing of this grant runs");
    assert.equal(mine.childRun, null, "no Task was dispatched without the captain");
    const st = await a.tool("run_status", { run }); assert.equal(st.body.state, "awaiting_captain", st.text); assert.deepEqual(st.body.waiting_on, ["dispatch"]); assert.equal(st.body.task, undefined);
    const cards = await a.tool("read_cards", { run }); assert.equal(cards.body.readOnly, true); assert.equal(cards.body.cards.length, 1); assert.equal(cards.body.cards[0].kind, "dispatch"); assert.equal(cards.body.cards[0].answer_on, "board");
    const board = (await s.api("/api/scards?open=1")).body.cards.find((c: any) => c.run === run);
    assert.equal(board.origin?.kind, "external-cli", "the board's card says it came from an external CLI"); assert.equal(board.origin.grant, A.id);
    assert.match(board.sections.en.why, new RegExp(`external CLI \\(grant ${A.id}\\)`));
  });
  await step("there is no approve tool: calling one fails and the card stays open", async () => {
    for (const name of ["approve_card", "answer_card", "studio_answer_agent_question", "merge", "change_staffing"]) {
      const r = await a.tool(name, { card: "SC-1", choice: "approve" }); assert.ok(r.isError, `${name} must fail`); assert.match(r.text, /no such tool/);
    }
    const st = await a.tool("run_status", { run }); assert.equal(st.body.state, "awaiting_captain");
  });
  await step("grant B cannot read grant A's run", async () => {
    for (const t of ["run_status", "read_cards"]) { const r = await b.tool(t, { run }); assert.match(r.body.error ?? "", new RegExp(`no run ${run} started by grant ${B.id}`), r.text); }
  });
  await step("the captain approves on the board: only then the Task starts, and the grant follows it", async () => {
    const card = (await s.api("/api/scards?open=1")).body.cards.find((c: any) => c.run === run);
    const ans = await s.api(`/api/scards/${card.id}/answer`, { choice: "approve" }); assert.equal(ans.status, 200, JSON.stringify(ans.body));
    let st: any; for (let i = 0; i < 100; i++) { st = (await a.tool("run_status", { run })).body; if (st.task) break; await Bun.sleep(150); }
    assert.ok(st.task, JSON.stringify(st)); assert.equal(st.workflow, "code-firstmate");
    const task = (await s.api(`/api/wruns/${st.task}`)).body; assert.equal(task.origin?.grant, A.id, "the dispatched Task is labelled with the grant");
    const viaB = await b.tool("run_status", { run: st.task }); assert.match(viaB.body.error ?? "", /no run/);
    await s.api(`/api/wruns/${st.task}/cancel`, { reason: "test done" });
  });
  await step("a pull request list grant: issued with scope prs, it reaches only the list's tools, edits Studio's list and is audited", async () => {
    const withProject = await post("/api/cli-grants", { scope: "prs", project: "sandbox", ttl: "1h" }, page()); assert.equal(withProject.status, 400, "a list grant has no project");
    const badScope = await post("/api/cli-grants", { scope: "everything", ttl: "1h" }, page()); assert.equal(badScope.status, 400);
    const asScript = await post("/api/cli-grants", { scope: "prs", ttl: "1h" }, { "content-type": "application/json", "x-crew-session": s.token }); assert.equal(asScript.status, 403, "only the captain's page issues it");
    const r = await post("/api/cli-grants", { scope: "prs", ttl: "1h" }, page()); assert.equal(r.status, 200, JSON.stringify(r.body)); const P = r.body.grant;
    assert.equal(P.scope, "prs"); assert.equal(P.project, ""); assert.equal(statSync(P.file).mode & 0o777, 0o600); assert.match(P.claudeMcpAdd, /--grant-file /);
    const c = mcp(P.file);
    try {
      const list = await c.rpc("tools/list"); const names = list.result.tools.map((t: any) => t.name);
      assert.ok(names.includes("prs_list") && names.includes("prs_watch") && names.includes("prs_settings"), names.join());
      assert.ok(!names.some((n: string) => ["start_run", "list_workflows", "run_status", "read_cards"].includes(n) || /apply|merge|approve/.test(n)), `no run tool and no GitHub write: ${names}`);
      for (const n of ["start_run", "prs_apply", "merge"]) { const x = await c.tool(n, {}); assert.ok(x.isError, `${n} must fail`); assert.match(x.text, /no such tool/); }
      const w = await c.tool("prs_watch", { url: "https://github.com/northwind/web-app" }); assert.ok(!w.isError && !w.body.error, w.text); assert.equal(w.body.added.repo, "northwind/web-app");
      const st = (await s.api("/api/prs")).body; assert.ok(st.watch.repos.some((x: any) => x.repo === "northwind/web-app"), "the board's list shows the repository the CLI added");
      const set = await c.tool("prs_settings", { settings: { evidence: { accounts: ["qa-lin"] } } }); assert.ok(!set.body.error, set.text);
      assert.deepEqual((await s.api("/api/prs")).body.settings.evidence.accounts, ["qa-lin"]);
      const ls = await c.tool("prs_list"); assert.ok(Array.isArray(ls.body.rows), ls.text);
      // a project grant cannot reach the list's tools
      const viaRuns = mcp(B.file); try { const x = await viaRuns.tool("prs_list"); assert.ok(x.isError); } finally { viaRuns.close(); }
      const events = readFileSync(join(s.data, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.workflow === "cli-grant" && e.data?.grant === P.id);
      const edits = events.filter((e) => e.type === "cli_grant_prs_edit").map((e) => e.data.tool); assert.deepEqual(edits, ["prs_watch", "prs_settings"], JSON.stringify(edits));
      assert.ok(events.some((e) => e.type === "cli_grant_issued" && e.data.scope === "prs"));
      await post(`/api/cli-grants/${P.id}/revoke`, {}, page()); const after = await c.tool("prs_list"); assert.ok(after.isError); assert.match(after.text, /HTTP 403/);
    } finally { c.close(); }
  });
  await step("a revoked grant gets HTTP 403 on its next call, and its token file is gone", async () => {
    const r = await post(`/api/cli-grants/${A.id}/revoke`, {}, page()); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.grant.state, "revoked");
    assert.ok(!existsSync(A.file));
    const after = await a.tool("run_status", { run }); assert.ok(after.isError); assert.match(after.text, /HTTP 403/); assert.match(after.text, /revoked/);
    const list = await a.rpc("tools/list"); assert.match(list.error?.message ?? "", /HTTP 403/);
  });
  await step("an expired grant gets HTTP 403 on its next call", async () => {
    const f = join(s.data, "cli-grants.json"), all = JSON.parse(readFileSync(f, "utf8"));
    all.find((g: any) => g.id === B.id).expiresAt = new Date(Date.now() - 1000).toISOString(); writeFileSync(f, JSON.stringify(all));
    const r = await b.tool("list_workflows"); assert.ok(r.isError); assert.match(r.text, /HTTP 403/); assert.match(r.text, /expired/);
  });
  await step("every issue, use, refusal and revoke is in Studio's event log", async () => {
    const types = readFileSync(join(s.data, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.workflow === "cli-grant").map((e) => e.type);
    for (const t of ["cli_grant_issued", "cli_grant_used", "cli_grant_run", "cli_grant_refused", "cli_grant_revoked"]) assert.ok(types.includes(t), `${t} missing in ${[...new Set(types)]}`);
  });
  await step("the board lists grants without any token or hash", async () => {
    const r = await s.api("/api/cli-grants"); assert.equal(r.status, 200); const txt = JSON.stringify(r.body);
    assert.ok(!/csg_g-/.test(txt) && !/tokenHash/.test(txt)); assert.deepEqual(r.body.grants.map((g: any) => g.state).sort(), ["expired", "revoked", "revoked"]);
  });
  a.close(); b.close();
  await step("the MCP helper refuses a missing grant file", async () => {
    const p = Bun.spawnSync(["bun", "src/mcp.ts", "--grant-file", join(s.data, "grants", "g-00000000")], { cwd: REPO, stdin: "ignore" });
    assert.equal(p.exitCode, 2); assert.match(p.stderr.toString(), /cannot read the grant file/);
  });
} finally { await s.close(); }
console.log(failed ? "\ncli-grant-mcp: FAILED" : "\ncli-grant-mcp: all passed");
process.exit(failed ? 1 : 0);
