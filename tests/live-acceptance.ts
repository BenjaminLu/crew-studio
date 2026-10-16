// scripts/live-acceptance.ts against a real Studio (src/server.ts) on a free port with throwaway data,
// stub CLI vendors (tests/stub-host-claude.mjs, tests/fixture/codex-account.mjs, tests/fixture/claude-login.mjs)
// and Studio's stub provider. No model, no sign-in, no network beyond 127.0.0.1.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { freePort, waitUp } from "./boot.mjs";
import { loadScenario, decideCard, validateScenario } from "../scripts/acceptance/scenarios";
import { normalize } from "../src/runtime/defs";

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const repo = join(import.meta.dir, "..");
const root = mkdtempSync(join(tmpdir(), "crew-live-acceptance-"));
const home = join(root, "home"), data = join(root, "data"), runtimeDir = join(root, "runtime");
const codexLog = join(root, "codex.jsonl");
const token = "liveacceptfixture" + "9f3c2a7b41d8e605";
mkdirSync(join(home, ".codex"), { recursive: true });
// the codex fixture reports `login status` signed in only for this offline account file; it holds no credential
writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { account_id: "fixture-native-staffing", refresh_token: "" } }));
writeFileSync(join(home, ".codex", "config.toml"), 'model="fixture-model"\nmodel_reasoning_effort="low"\n');
// the Doctor reads `<bin> --version`, then `claude auth status --json` / `codex login status`: thin wrappers give the fixtures a version
const wrap = (name: string, fixture: string) => { const f = join(root, name); writeFileSync(f, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${name} 0.0.0-fixture"; exit 0; fi\nexec bun "${join(import.meta.dir, fixture)}" "$@"\n`, { mode: 0o755 }); return f; };
const claudeBin = wrap("claude", "fixture/claude-login.mjs"), codexBin = wrap("codex", "fixture/codex-account.mjs");

// three tiny workflows the test seeds as v1 definitions: a safe card, a merge card, a card left for a person
const seed = (def: any) => { const dir = join(data, "workflows", def.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "v1.json"), JSON.stringify({ ...normalize({ roles: [], params: {}, ...def }), version: 1, parent: null, createdAt: new Date().toISOString(), by: "fixture", note: "fixture", diff: null, seed: null })); };
seed({ id: "accept-pass", name: "Acceptance pass fixture", nodes: [
  { id: "ask", kind: "card", label: "Go ahead?", x: 1, y: 1, card: { options: [{ id: "continue", label: "Continue" }, { id: "close", label: "Close", hold: true }] } },
  { id: "done", kind: "hook", label: "Done", x: 2, y: 1 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 2 }],
  edges: [["ask", "done", "continue"], ["ask", "closed", "close"]] });
seed({ id: "accept-unsafe", name: "Acceptance unsafe fixture", nodes: [
  { id: "gate", kind: "card", label: "Merge it?", x: 1, y: 1, args: { card_kind: "merge" }, card: { options: [{ id: "merge", label: "Merge" }, { id: "close", label: "Close", hold: true }] } },
  { id: "done", kind: "hook", label: "Done", x: 2, y: 1 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 2 }],
  edges: [["gate", "done", "merge"], ["gate", "closed", "close"]] });
seed({ id: "accept-wait", name: "Acceptance wait fixture", nodes: [
  { id: "hold", kind: "card", label: "A person decides", x: 1, y: 1, card: { options: [{ id: "continue", label: "Continue" }] } },
  { id: "done", kind: "hook", label: "Done", x: 2, y: 1 }], edges: [["hold", "done", "continue"]] });

const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env: any = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user",
  CREW_DATA: data, CREW_RUNTIME_DIR: runtimeDir, CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_LOCAL_UNRESTRICTED: "0",
  CREW_CLAUDE_BIN: claudeBin, CREW_HOST_CLAUDE_BIN: join(import.meta.dir, "stub-host-claude.mjs"),
  CREW_CODEX_BIN: codexBin, CREW_HOST_CODEX_BIN: join(import.meta.dir, "fixture/codex-account.mjs"), ACCOUNT_FIXTURE_LOG: codexLog };
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "CREW_MAIN_PROJECT", "CREW_FM_STATE"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = ""; app.stdout.on("data", (b) => { serverOut += b; });
const api = async (path: string) => (await fetch(base + path, { headers: { "x-crew-session": token } })).json();

// the script never receives the session in its environment: it finds it the way `open` does
const scriptEnv = (): any => { const e: any = { ...env }; delete e.CREW_SESSION_TOKEN; delete e.CREW_DATA; delete e.CREW_PORT; return e; };
const outputs: string[] = [];
async function accept(args: string[]) {
  const p = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", base, "--offline-fixture", ...args], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); const code = await p.exited;
  outputs.push(out, err);
  const md = /^report: (.+\.md)$/m.exec(out)?.[1] ?? null, js = /^json: (.+\.json)$/m.exec(out)?.[1] ?? null;
  const report = js && existsSync(js) ? JSON.parse(readFileSync(js, "utf8")) : null; const mdText = md && existsSync(md) ? readFileSync(md, "utf8") : "";
  if (md) outputs.push(mdText); if (js && existsSync(js)) outputs.push(readFileSync(js, "utf8"));
  return { code, out, err, md, js, report, mdText };
}
const fx = (name: string) => ["--scenario", join(import.meta.dir, "fixture/acceptance", `${name}.yaml`)];
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

try {
  await waitUp(base, app);

  // --- scenario format (the reviewed list the stub harness shares) ---
  const bundled = readdirSync(join(repo, "workflows/acceptance")).filter((f) => f.endsWith(".yaml"));
  const catalog = (await api("/api/wf")).workflows.map((w: any) => w.id).filter((id: string) => !id.startsWith("accept-")).sort();
  ok(JSON.stringify(bundled.map((f) => f.replace(/\.yaml$/, "")).sort()) === JSON.stringify(catalog), "one reviewed scenario per bundled workflow on the Start form", `${bundled} vs ${catalog}`);
  const problems = bundled.flatMap((f) => { try { loadScenario(join(repo, "workflows/acceptance", f)); return []; } catch (e: any) { return [`${f}: ${e.message}`]; } });
  ok(problems.length === 0, "every bundled scenario file passes validation", problems.join("; "));
  let refused = ""; try { validateScenario({ schema: 1, workflow: "x", topic: "t", start: { provider: null, params: {} }, providers: [], approvals: { staffing: false, dispatch: false }, cards: [{ node: "merge-card", answer: "merge" }], expect: { status: "succeeded", result: null, artifacts: [] }, budget: { wall_minutes: 1, max_rounds: 1 } }, "inline"); } catch (e: any) { refused = e.message; }
  ok(/irreversible|external/i.test(refused), "a scenario that lists a merge answer is refused when it loads", refused);
  const card = (o: any) => ({ id: "SC-1", node: "ask", kind: "question", options: [{ id: "continue" }, { id: "close" }], status: "open", captainOnly: false, confirmDoor: false, door: null, detail: null, ...o });
  const sc = loadScenario(join(import.meta.dir, "fixture/acceptance/accept-pass.yaml"));
  ok(decideCard(sc, card({})).action === "answer" && decideCard(sc, card({ node: "other" })).action === "stop", "only a listed card is answered; any other card stops");
  ok(decideCard(sc, card({ kind: "merge" })).action === "stop" && decideCard(sc, card({ kind: "dispatch" })).action === "stop" && decideCard(sc, card({ detail: { remoteTarget: { repository: "x" } } })).action === "stop" && decideCard(sc, card({ confirmDoor: true })).action === "stop",
    "merge, dispatch (without approval), a remote GitHub target and a one-way door stop even when the node is listed");

  // --- a passing workflow ---
  const before = (await api("/api/tasks")).tasks.length;
  const a = await accept(fx("accept-pass"));
  ok(a.code === 0 && a.report?.verdict === "PASS", "a passing workflow: exit 0 and verdict PASS", `${a.code} ${a.out} ${a.err}`);
  ok(a.md?.startsWith(join(data, "acceptance", today) + "/") && a.md.endsWith("/accept-pass.md") && a.js?.endsWith("/accept-pass.json"), "the report is written under the target Studio's data/acceptance/<date>/<workflow>.{md,json} and its path printed", `${a.md} ${a.js}`);
  const task = a.report ? await api(`/api/tasks/${a.report.task.id}`) : null;
  ok(task && task.text.startsWith(`ACCEPT ${today} `) && JSON.stringify(task.params) === "{}" && task.workflow === "accept-pass" && (await api("/api/tasks")).tasks.length === before + 1,
    "the Task starts with exactly the board's Start form body, its brief prefixed ACCEPT <date>", JSON.stringify(task && { text: task.text, params: task.params }));
  const askNode = a.report?.nodes?.find((n: any) => n.node === "ask");
  ok(askNode && askNode.outcome === "pass" && askNode.status === "passed" && typeof askNode.durationSeconds === "number" && askNode.log.startsWith(`${base}/#/run/`) && a.report.cards[0]?.answered === "continue",
    "per node: status, outcome class, duration and log link; the safe card's answer is recorded", JSON.stringify(askNode));
  ok(a.report?.sse?.events > 0, "the run is followed over the server's event stream", JSON.stringify(a.report?.sse));
  ok(/OFFLINE FIXTURE/.test(a.mdText) && a.report?.offlineFixture === true, "an offline fixture run says so: it is never a live acceptance");

  // --- a failing workflow: exact error text and log link ---
  const f = await accept(fx("documents-fail"));
  const draft = f.report?.nodes?.find((n: any) => n.node === "draft");
  ok(f.code === 1 && f.report?.verdict === "FAIL", "a failing workflow: exit 1 and verdict FAIL", `${f.code} ${f.out} ${f.err}`);
  ok(draft && draft.firstError === "the agent wrote no doc.md" && draft.outcome === "error" && draft.provider === "stub" && draft.model === "no model" && draft.log === `${base}/#/runs/node/${f.report.task.id}/draft/1`,
    "the failing node carries the exact first error, its provider/model and its transcript link", JSON.stringify(draft));
  ok(f.mdText.includes("the agent wrote no doc.md") && f.mdText.includes(`${base}/#/runs/node/${f.report.task.id}/draft/1`) && f.report.run.error === "Produce draft failed: the agent wrote no doc.md",
    "the markdown report shows the exact error and the log link; the run's own error is kept verbatim");
  ok(f.report?.problems?.some((p: string) => /status failed, expected succeeded/.test(p)) && f.report?.problems?.some((p: string) => /deliver/.test(p)), "the report names each unmet expectation", JSON.stringify(f.report?.problems));
  ok(f.md?.endsWith("/documents.md"), "the report is named after the workflow", f.md ?? "");

  // --- STOP on an unsafe card ---
  const u = await accept(fx("accept-unsafe"));
  const uTask = u.report ? await api(`/api/tasks/${u.report.task.id}`) : null;
  ok(u.code === 2 && u.report?.verdict === "STOP" && /merge/.test(u.report?.stop?.reason ?? ""), "a merge card stops the run (exit 2) although the scenario lists it", `${u.code} ${JSON.stringify(u.report?.stop)}`);
  ok(uTask && uTask.cards.every((c: any) => c.status === "open") && uTask.task.status === "needs-you", "the unsafe card is left unanswered and the Task is left waiting for the captain", JSON.stringify([uTask?.task?.status, uTask?.cards?.map((c: any) => c.status)]));
  ok(/STOP/.test(u.out) && u.mdText.includes(u.report?.stop?.card ?? "none"), "the stop is printed and the report names the card");

  // --- a provider not signed in ---
  const tasksBefore = (await api("/api/tasks")).tasks.length;
  const n = await accept(fx("needs-claude"));
  ok(n.code === 2 && n.report?.verdict === "STOP" && /claude/i.test(n.report?.stop?.reason ?? "") && /not signed in/i.test(n.out + n.err), "a provider that is not signed in stops before anything starts, with a clear message", `${n.code} ${n.out} ${n.err}`);
  ok((await api("/api/tasks")).tasks.length === tasksBefore && n.report?.task === null, "no Task is started when a provider is not signed in");
  const trace = existsSync(join(home, ".claude-login-trace.jsonl")) ? readFileSync(join(home, ".claude-login-trace.jsonl"), "utf8") : "";
  const codexTrace = existsSync(codexLog) ? readFileSync(codexLog, "utf8") : "";
  ok(trace.includes('"status"') && !trace.includes('"login"') && !codexTrace.includes("account/login/start"), "login state is only read: no Claude or Codex sign-in was started", trace.slice(-400));
  ok(!existsSync(join(home, ".claude-login-marker")), "the fixture's Claude login marker was never written");

  // --- budget: rounds, then wall time ---
  const r = await accept(fx("budget-rounds"));
  ok(r.code === 3 && r.report?.verdict === "BUDGET" && /round/i.test(r.report?.budget?.exceeded ?? ""), "more rounds than the budget allows: exit 3, verdict BUDGET", `${r.code} ${JSON.stringify(r.report?.budget)}`);
  const w = await accept(fx("budget-wall"));
  const wTask = w.report ? await api(`/api/tasks/${w.report.task.id}`) : null;
  ok(w.code === 3 && w.report?.verdict === "BUDGET" && /wall/i.test(w.report?.budget?.exceeded ?? ""), "a run past its wall time: exit 3, verdict BUDGET", `${w.code} ${JSON.stringify(w.report?.budget)}`);
  ok(wTask?.status === "cancelled" && w.report?.budget?.cancelled === true, "a run over budget is cancelled so it spends nothing more", wTask?.status);

  // --- no instance: a clear refusal, no sign-in, nothing printed that matters ---
  const other = await freePort();
  const p = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", `http://127.0.0.1:${other}`, ...fx("accept-pass")], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
  const [o1, o2] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); const pc = await p.exited; outputs.push(o1, o2);
  ok(pc === 4 && /No verified running Studio/.test(o1 + o2), "no running Studio at the base: exit 4 with a clear message", o1 + o2);
  const live = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", base, ...fx("documents-fail")], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
  const [l1, l2] = await Promise.all([new Response(live.stdout).text(), new Response(live.stderr).text()]); const lc = await live.exited; outputs.push(l1, l2);
  ok(lc === 2 && /stub is not a real model/.test(l1 + l2), "without --offline-fixture a stub provider is refused: live acceptance needs real models", l1 + l2);

  // --- no token anywhere ---
  const reports = existsSync(join(data, "acceptance", today)) ? readdirSync(join(data, "acceptance", today)).map((x) => readFileSync(join(data, "acceptance", today, x), "utf8")) : [];
  ok(outputs.length > 10 && reports.length >= 10 && [...outputs, ...reports].every((t) => !t.includes(token)), "no session token in any output or report", String(reports.length));
} finally {
  app.kill("SIGTERM"); await new Promise((r) => app.once("exit", r));
  rmSync(root, { recursive: true, force: true });
}
console.log(`\nlive-acceptance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
