// scripts/live-acceptance.ts against a real Studio (src/server.ts) on a free port with throwaway data,
// stub CLI vendors (tests/stub-host-claude.mjs, tests/fixture/codex-account.mjs, tests/fixture/claude-login.mjs)
// and Studio's stub provider. No model, no sign-in, no network beyond 127.0.0.1.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { freePort, waitUp } from "./boot.mjs";
import { loadScenario, decideCard, validateScenario, defHash, externalEffect, LOCAL_ACTIONS } from "../scripts/acceptance/scenarios";
// no authorization window is open unless a case says so
const decide = (s: any, c: any, d: any, w: string[] = []) => decideCard(s, c, d, { openAuthWindows: w });
import { normalize } from "../src/runtime/defs";
import { modelCalls, modelProblems, nodeRecords, providersToCheck } from "../scripts/acceptance/report";

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
seed({ id: "accept-two", name: "Acceptance two-card fixture", nodes: [
  { id: "ask", kind: "card", label: "Go ahead?", x: 1, y: 1, card: { options: [{ id: "continue", label: "Continue" }] } },
  { id: "hold", kind: "card", label: "A person decides", x: 2, y: 1, card: { options: [{ id: "continue", label: "Continue" }] } },
  { id: "done", kind: "hook", label: "Done", x: 3, y: 1 }], edges: [["ask", "hold", "continue"], ["hold", "done", "continue"]] });
seed({ id: "accept-wait", name: "Acceptance wait fixture", nodes: [
  { id: "hold", kind: "card", label: "A person decides", x: 1, y: 1, card: { options: [{ id: "continue", label: "Continue" }] } },
  { id: "done", kind: "hook", label: "Done", x: 2, y: 1 }], edges: [["hold", "done", "continue"]] });

const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env: any = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user",
  CREW_DATA: data, CREW_RUNTIME_DIR: runtimeDir, CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_LOCAL_UNRESTRICTED: "0",
  CREW_CLAUDE_BIN: claudeBin, CREW_HOST_CLAUDE_BIN: join(import.meta.dir, "stub-host-claude.mjs"),
  CREW_CODEX_BIN: codexBin, CREW_HOST_CODEX_BIN: join(import.meta.dir, "fixture/codex-account.mjs"), ACCOUNT_FIXTURE_LOG: codexLog };
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "CREW_MAIN_PROJECT", "CREW_FM_STATE"]) delete env[k];
const boot = () => spawn("bun", ["src/server.ts"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
let app = boot();
const api = async (path: string) => (await fetch(base + path, { headers: { "x-crew-session": token } })).json();
const post = async (path: string, body: unknown) => (await fetch(base + path, { method: "POST", headers: { "x-crew-session": token, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
/**
 * A registered Studio instance that forwards to the real one but fails every read of a Task after
 * the first `okReads`: the driver finds it exactly as it finds Studio (instance record + proof).
 */
async function faultyStudio(okReads: number) {
  const boot = randomBytes(24).toString("hex"); let reads = 0;
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/api/instance") return Response.json({ pid: process.pid, boot, proof: createHmac("sha256", token).update(`crew-launch-v1\0${boot}\0${u.searchParams.get("challenge")}`).digest("hex") });
    if (req.method === "GET" && /^\/api\/tasks\/R-\d+$/.test(u.pathname) && ++reads > okReads) return Response.json({ error: "fixture proxy: this read fails" }, { status: 503 });
    const h = new Headers(req.headers); h.delete("host"); h.delete("content-length");
    const r = await fetch(base + u.pathname + u.search, { method: req.method, headers: h, body: req.method === "GET" ? undefined : await req.text() });
    return new Response(r.body, { status: r.status, headers: r.headers });
  } });
  const rec = join(runtimeDir, `${boot}.json`), key = join(runtimeDir, `${boot}.key`);
  writeFileSync(key, token, { mode: 0o600 }); writeFileSync(rec, JSON.stringify({ schema: 1, boot, pid: process.pid, origin: `http://127.0.0.1:${srv.port}`, data }), { mode: 0o600 });
  return { base: `http://127.0.0.1:${srv.port}`, stop: () => { srv.stop(true); rmSync(rec, { force: true }); rmSync(key, { force: true }); } };
}

// the script never receives the session in its environment: it finds it the way `open` does
const scriptEnv = (): any => { const e: any = { ...env }; delete e.CREW_SESSION_TOKEN; delete e.CREW_DATA; delete e.CREW_PORT; return e; };
const outputs: string[] = [];
async function accept(args: string[], at = base) {
  const p = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", at, "--offline-fixture", ...args], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
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
  // internal and retired workflows have a scenario too (live: false, for the offline stub harness); the Start form offers the rest
  const bundled = readdirSync(join(repo, "tests/acceptance")).filter((f) => f.endsWith(".yaml") && loadScenario(join(repo, "tests/acceptance", f)).live !== false);
  const catalog = (await api("/api/wf")).workflows.map((w: any) => w.id).filter((id: string) => !id.startsWith("accept-")).sort();
  ok(JSON.stringify(bundled.map((f) => f.replace(/\.yaml$/, "")).sort()) === JSON.stringify(catalog), "one reviewed scenario per bundled workflow on the Start form", `${bundled} vs ${catalog}`);
  const problems = bundled.flatMap((f) => { try { loadScenario(join(repo, "tests/acceptance", f)); return []; } catch (e: any) { return [`${f}: ${e.message}`]; } });
  ok(problems.length === 0, "every bundled scenario file passes validation", problems.join("; "));
  const pins = await Promise.all(bundled.map(async (f) => { const sc = loadScenario(join(repo, "tests/acceptance", f)); const d = (await api(`/api/wf/${sc.workflow}`)).def; return defHash(d) === sc.pin.sha256 ? null : `${sc.workflow}: ${defHash(d)} vs ${sc.pin.sha256}`; }));
  ok(pins.every((x) => !x), "every bundled scenario pins the definition this Studio really serves", pins.filter(Boolean).join("; "));

  // --- card safety is an allowlist (the reviewer's probe, case by case) ---
  const defOf = async (id: string) => (await api(`/api/wf/${id}`)).def;
  const gh = await defOf("github-review"), docs = await defOf("documents");
  const scen = (def: any, cards: any[], extra: any = {}) => validateScenario({ schema: 2, workflow: def.id, pin: { sha256: defHash(def) }, topic: "t", start: { provider: null, params: {} }, providers: [], approvals: { staffing: false }, cards, expect: { status: "succeeded", artifacts: [] }, budget: { wall_minutes: 1, max_rounds: 1 }, ...extra }, "inline");
  const refusedBy = (f: () => unknown) => { try { f(); return ""; } catch (e: any) { return e.message; } };
  const card = (o: any) => ({ id: "SC-9", node: "ask", kind: "question", options: [{ id: "continue" }, { id: "close" }], status: "open", captainOnly: false, confirmDoor: false, door: null, detail: null, ...o });
  // 1: the remote-ready card (approve-name pushes; rebase rebuilds) passes no rule
  const rr = scen(gh, [{ node: "remote-ready", kind: "question", answer: "approve-name" }, { node: "remote-ready", kind: "plan", answer: "rebase" }]);
  const rrCard = card({ node: "remote-ready", options: [{ id: "approve-name" }, { id: "rebase" }], captainOnly: true });
  ok(decide(rr, rrCard, gh).action === "stop" && decide(rr, { ...rrCard, captainOnly: false }, gh).action === "stop" && decide(rr, { ...rrCard, kind: "plan", captainOnly: false }, gh).action === "stop" && /remote\.ready/.test((decide(rr, { ...rrCard, captainOnly: false }, gh) as any).reason),
    "1: a card on github-review's remote-ready node is never answered: its own action (remote.ready) is external", JSON.stringify(decide(rr, { ...rrCard, captainOnly: false }, gh)));
  // 2: dispatch, step-back continue, budget extend cannot be allowed; a dispatch-like answer that reaches pr.open stops
  ok(/approvals has only staffing/.test(refusedBy(() => scen(gh, [], { approvals: { staffing: false, dispatch: true } }))) && /kind acceptance, question or plan/.test(refusedBy(() => scen(gh, [{ node: "dispatch", kind: "dispatch", answer: "dispatch" }])))
    && /kind acceptance, question or plan/.test(refusedBy(() => scen(gh, [{ node: "step-back", kind: "step-back", answer: "continue" }]))) && /kind acceptance, question or plan/.test(refusedBy(() => scen(gh, [{ node: "budget", answer: "extend" }]))),
    "2: dispatch approvals, step-back continue and budget extend cannot be written into a scenario");
  const disguised = scen(gh, [{ node: "dispatch", kind: "question", answer: "dispatch" }, { node: "step-back", kind: "question", answer: "continue" }]);
  const dd = decide(disguised, card({ node: "dispatch", options: [{ id: "dispatch" }] }), gh) as any, sb = decide(disguised, card({ node: "step-back", options: [{ id: "continue" }] }), gh) as any;
  ok(dd.action === "stop" && /pr-open \(pr\.open\)/.test(dd.reason) && sb.action === "stop" && /pr\.open|remote\.ready/.test(sb.reason), "2: a question-kind card on dispatch or step-back still stops: the walk reaches pr.open before another card", `${dd.reason} | ${sb.reason}`);
  // 3: one-way doors on either field
  const pass = loadScenario(join(import.meta.dir, "fixture/acceptance/accept-pass.yaml")), passDef = await defOf("accept-pass");
  ok(decide(pass, card({}), passDef).action === "answer" && decide(pass, card({ door: "one-way" }), passDef).action === "stop" && decide(pass, card({ detail: { door: { kind: "one-way" } } }), passDef).action === "stop" && decide(pass, card({ confirmDoor: true }), passDef).action === "stop",
    "3: a one-way door stops whether it is on door, detail.door.kind or confirmDoor");
  // 4: no names: an innocent-looking node with an external action stops; any action not reviewed as local stops
  const syn = (doName: string, nodeName: string) => ({ id: "syn", kind: "x", roles: [], params: {}, nodes: [{ id: "ask", kind: "card", card: { options: [{ id: "continue" }] } }, { id: nodeName, kind: "hook", do: doName }, { id: "done", kind: "hook" }], edges: [{ from: "ask", to: nodeName, when: "continue" }, { from: nodeName, to: "done" }] });
  const names = ["tidy", "上線", "合併", "發布", "推送", "部署", "openPR", "createPr", "pull-request", "upload", "send", "submit", "commit", "tag", "rollout", "land", "promote-now"];
  const effects = ["fileorg.apply", "pr.open", "github.comment", "git.merge", "firstmate.dispatch", "pack-genesis-publish", "send.mail"];
  const allStop = names.every((n, i) => { const d = syn(effects[i % effects.length], n); return decide(scen(d, [{ node: "ask", kind: "question", answer: "continue" }]), card({ options: [{ id: "continue" }] }), d).action === "stop"; });
  const localOk = (() => { const d = syn("deliver.round", "x"); return decide(scen(d, [{ node: "ask", kind: "question", answer: "continue" }]), card({ options: [{ id: "continue" }] }), d).action === "answer"; })();
  ok(allStop && localOk, "4: the effect walk reads node actions, not names: every unreviewed or external action stops, a reviewed local one passes");
  // 5: unknown kinds and captain-only cards
  const dsc = scen(docs, [{ node: "accept", kind: "acceptance", answer: "approve-draft" }]);
  const acc = card({ node: "accept", kind: "acceptance", options: [{ id: "approve-draft" }, { id: "changes" }, { id: "reject" }], captainOnly: true });
  ok(["permission", "round-budget", "future-kind"].every((k) => decide(dsc, { ...acc, kind: k }, docs).action === "stop") && /kind acceptance, question or plan/.test(refusedBy(() => scen(docs, [{ node: "accept", kind: "permission", answer: "approve-draft" }]))),
    "5: permission, round-budget and unknown kinds are never answered, and a rule cannot name them");
  ok(decide(dsc, acc, docs).action === "answer" && decide(scen(docs, [{ node: "accept", kind: "acceptance", answer: "reject" }]), acc, docs).action === "stop" && /unknown field captain_only/.test(refusedBy(() => scen(docs, [{ node: "accept", kind: "acceptance", answer: "approve-draft", captain_only: true }]))),
    "5: a captain-only card is answered only as an exact allowlisted (workflow, node, kind, option) pair; a scenario cannot allow one itself");
  // A: the deliver acceptance cards offer approve-<producer>; the shipped scenarios answer exactly those, allowlisted at their pin
  const shipped = await Promise.all(["documents", "images", "video", "web-prototype"].map(async (w) => { const sc = loadScenario(join(repo, "tests/acceptance", `${w}.yaml`)); const d = await defOf(w);
    const producers = w === "web-prototype" ? ["design-a", "design-b"] : ["draft"]; const c = card({ node: "accept", kind: "acceptance", captainOnly: true, options: [...producers.map((p) => ({ id: `approve-${p}` })), { id: "changes" }, { id: "reject" }] });
    return decide(sc, c, d).action === "answer" && decide(sc, { ...c, options: [{ id: "approved" }] }, d).action === "stop" ? null : w; }));
  const web = await defOf("web-prototype"), webB = decide(scen(web, [{ node: "accept", kind: "acceptance", answer: "approve-design-b" }]), card({ node: "accept", kind: "acceptance", captainOnly: true, options: [{ id: "approve-design-a" }, { id: "approve-design-b" }] }), web);
  ok(shipped.every((x) => !x) && webB.action === "answer", "A: the shipped documents/images/video/web-prototype scenarios answer the approve-<producer> option their captain-only card really offers", shipped.filter(Boolean).join(","));
  const edited = { ...docs, nodes: docs.nodes.map((n: any) => n.id === "library" ? { ...n, do: "pr.open" } : n) };
  ok(decide(dsc, acc, edited).action === "stop", "5: a changed definition voids the pin and the allowlist: the same card stops");
  // 6: no options
  ok(decide(pass, card({ options: undefined }), passDef).action === "stop" && decide(pass, card({ options: [] }), passDef).action === "stop", "6: a card without options is never answered");

  // --- round 4 ---
  const N = (id: string, kind: string, extra: any = {}) => ({ id, kind, label: id, ...extra });
  const wq = (def: any) => scen(def, [{ node: "ask", kind: "question", answer: "go" }]);
  const qc = card({ options: [{ id: "go" }, { id: "no" }] });
  // F1: an edge's blocking checks re-route its source as "fail": every out-edge counts, at every step
  const f1 = { id: "f1", kind: "x", roles: [], params: {}, nodes: [N("ask", "card"), N("ok", "hook"), N("pub", "hook", { do: "pr.open" })], edges: [{ from: "ask", to: "ok", when: "go", checks: [{ use: "core/x" }] }, { from: "ask", to: "pub", when: "fail" }] };
  const f1b = { id: "f1b", kind: "x", roles: [], params: {}, nodes: [N("ask", "card"), N("a", "hook"), N("ok", "hook"), N("pub", "hook", { do: "git.merge" })], edges: [{ from: "ask", to: "a", when: "go" }, { from: "a", to: "ok", when: "ok", checks: [{ use: "core/x" }] }, { from: "a", to: "pub", when: "fail" }] };
  ok(decide(wq(f1), qc, f1).action === "stop" && decide(wq(f1b), qc, f1b).action === "stop", "F1: an edge whose checks can re-route the card as fail into pr.open stops, at the first step and later ones", JSON.stringify(decide(wq(f1), qc, f1)));
  // F7: card effects, workflow hooks, unreviewed card modes, open authorization windows
  const eff = { id: "eff", kind: "x", roles: [], params: {}, nodes: [N("ask", "card", { card: { options: [{ id: "go" }], effects: { go: { policy: "round_cap", add: 2 } } } }), N("done", "hook")], edges: [{ from: "ask", to: "done" }] };
  const hk = { id: "hk", kind: "x", roles: [], params: {}, hooks: [{ at: "after:ask", use: "core/x" }], nodes: [N("ask", "card"), N("done", "hook")], edges: [{ from: "ask", to: "done" }] };
  const md = { id: "md", kind: "x", roles: [], params: {}, nodes: [N("ask", "card", { args: { mode: "pack-promote" } }), N("done", "hook")], edges: [{ from: "ask", to: "done" }] };
  const plain = { id: "pl", kind: "x", roles: [], params: {}, nodes: [N("ask", "card"), N("done", "hook")], edges: [{ from: "ask", to: "done" }] };
  ok(/card effect/.test((decide(wq(eff), qc, eff) as any).reason) && /hooks/.test((decide(wq(hk), qc, hk) as any).reason) && /card mode pack-promote/.test((decide(wq(md), qc, md) as any).reason) && decide(wq(plain), qc, plain).action === "answer",
    "F7: a card effect (round_cap +2), workflow hooks and an unreviewed card mode stop; a plain card passes");
  ok(/authorization window G-1 is open/.test((decide(wq(plain), qc, plain, ["G-1"]) as any).reason) && decideCard(wq(plain), qc, plain, undefined as any).action === "stop", "F7: an open authorization window stops (the next card is then no gate); a caller that says nothing about windows stops too");
  // F8: the coffee kit's paid generation and the unregistered note action are not local
  ok(!LOCAL_ACTIONS.has("coffee.image") && !LOCAL_ACTIONS.has("coffee.video") && !LOCAL_ACTIONS.has("note") && externalEffect({ id: "c", nodes: [N("ask", "card"), N("img", "hook", { do: "coffee.image" })], edges: [{ from: "ask", to: "img" }] }, "ask", "go")?.do === "coffee.image",
    "F8: coffee.image, coffee.video and note are not in LOCAL_ACTIONS; a walk reaching coffee.image stops");
  // F10: decideCard holds on its own when a caller skips validateScenario
  const plain2 = { ...plain, nodes: [...plain.nodes, N("other", "card")] };
  const raw: any = { schema: 2, workflow: "pl", pin: { sha256: defHash(plain2) }, cards: [{ node: "ask", kind: "merge", action: "answer", answer: "go" }, { node: "other", action: "answer", answer: "go" }], approvals: { staffing: false } };
  const r10a = decide(raw, card({ kind: "merge", options: [{ id: "go" }] }), plain2) as any, r10b = decide(raw, card({ node: "other", kind: "question", options: [{ id: "go" }] }), plain2) as any;
  ok(r10a.action === "stop" && /not answerable/.test(r10a.reason) && r10b.action === "stop" && /not answerable/.test(r10b.reason),
    "F10: an unvalidated rule naming kind merge, or no kind at all, is still refused by decideCard");
  // F5: rounds with no provider are flagged; loop coordinator jobs and judged-check votes count as model calls
  const f5view = { id: "R-950", def: { nodes: [N("draft", "agent"), N("fix", "loop")] }, nodes: { draft: { state: "passed" }, fix: { state: "passed", data: { jobs: [{ id: "j1", provider: "codex", model: "gpt-x" }] } } },
    rounds: [{ id: "R-950/draft/1", node: "draft", actor: { kind: "agent", provider: null, model: null }, outcome: "passed", startedAt: null, endedAt: null }], ledger: [{ check: "core/judge", seq: 4, votes: [{ by: "j", provider: "stub", model: "no model", verdict: "pass" }] }], ctx: {} };
  const f5nodes = nodeRecords(base, f5view), f5calls = modelCalls(f5view, f5nodes), f5p = modelProblems(f5nodes, false, f5calls);
  ok(f5calls.some((c) => c.call === "codex/gpt-x" && /job fix/.test(c.from)) && f5calls.some((c) => c.call === "stub/no model" && /vote core\/judge/.test(c.from)) && f5p.some((p) => /draft ran 1 round\(s\) with no provider/.test(p)) && f5p.some((p) => /vote core\/judge#4 ran on stub\/no model, not a real model/.test(p)),
    "F5: an agent round with no provider is flagged; loop coordinator jobs and judged-check votes are model calls and must be real", JSON.stringify(f5p));
  // F6: the login check follows the engine's pick order
  const startup = await defOf("startup-recursion"), ghDef = await defOf("github-review");
  const sp6 = providersToCheck(startup, null, new Set(), ["claude", "codex"]);
  ok(sp6.some((n) => n.provider === "claude" && /role founder/.test(n.why)) && sp6.some((n) => n.provider === "codex" && /role judge/.test(n.why)) && !sp6.some((n) => /policy/.test(n.why)), "F6: role providers (founder claude, judge codex) are what the startup workflow checks", JSON.stringify(sp6.slice(0, 3)));
  const gh6 = providersToCheck(ghDef, "codex", new Set(), ["claude", "codex"]), jd6 = providersToCheck({ nodes: [N("c", "check", { checks: [{ use: "core/j" }, { use: "core/k", provider: "claude" }] })], edges: [] }, null, new Set(["core/j", "core/k"]), ["claude", "codex"]);
  const nd6 = providersToCheck({ roles: [{ id: "w", provider: "codex" }], nodes: [N("a", "agent", { role: "w", provider: "claude" }), N("l", "loop", { args: { coordinator: "w" } })], edges: [] }, "stub", new Set(), ["claude", "codex"]);
  ok(gh6.every((n) => n.provider === "codex") && gh6.some((n) => /loop .* coordinator/.test(n.why)) && jd6.filter((n) => /core\/j/.test(n.why)).map((n) => n.provider).join() === "claude,codex" && jd6.some((n) => n.provider === "claude" && /core\/k/.test(n.why))
    && nd6[0].provider === "claude" && /node provider/.test(nd6[0].why) && nd6[1].provider === "codex" && /role w/.test(nd6[1].why),
    "F6: node provider, then role, then Start form, then policy; loop coordinators and judged checks are included", JSON.stringify({ gh6: gh6.slice(0, 2), jd6, nd6 }));

  // --- hook nodes that call a model: provider/model from the artifact they made, and required ---
  const imagesDef = await defOf("images");
  const hookView = (createdBy: any) => ({ id: "R-900", def: imagesDef, nodes: { intake: { state: "passed" }, draft: { state: "passed" }, checks: { state: "passed" } }, rounds: [], ctx: { deliver: { draft: { id: "out-r-900-draft", n: 1, producer: "draft" } } } });
  const arts = (createdBy: any) => new Map([["out-r-900-draft", createdBy ? [{ n: 1, createdBy }] : []]]);
  const real = nodeRecords(base, hookView(null), arts({ kind: "agent", provider: "codex", model: "gpt-image-fixture" }));
  const rd = real.find((n) => n.node === "draft");
  ok(rd?.provider === "codex" && rd?.model === "gpt-image-fixture" && rd?.source === "artifact" && modelProblems(real, false).length === 0, "a model-calling hook (image.generate) records provider/model from the artifact it made", JSON.stringify(rd));
  const none = nodeRecords(base, hookView(null), arts(null)), fake = nodeRecords(base, hookView(null), arts({ kind: "agent", provider: "stub", model: "no model" }));
  ok(/not proven/.test(modelProblems(none, false).join()) && /not a real model/.test(modelProblems(fake, false).join()), "the real-model check requires it: a model hook with no record, or with a non-real vendor, fails", `${modelProblems(none, false)} | ${modelProblems(fake, false)}`);

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

  ok(a.report?.completion === "complete" && !/stopped by design/.test(a.mdText), "a run that ends as expected is labelled complete");

  // --- a stop_at point: reached, stopped by design, not complete ---
  const sa = await accept(fx("stop-at"));
  ok(sa.code === 0 && sa.report?.verdict === "PASS" && sa.report?.completion === "reached hold, stopped by design" && /reached hold, stopped by design; not complete/.test(sa.mdText) && /stopped by design/.test(sa.out),
    "an expected stop_at is labelled 'reached <card>, stopped by design' and not complete", `${sa.code} ${JSON.stringify(sa.report?.completion)} ${sa.out}`);

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
  const claudeRow = n.report?.providers?.find((p: any) => p.provider === "claude");
  ok(claudeRow?.state === "not signed in" && /Doctor item claude: authenticated=false/.test(claudeRow?.doctor ?? "") && /Doctor item claude: authenticated=false/.test(n.err + n.mdText),
    "the report and the message say exactly which provider and what the Doctor reported", JSON.stringify(claudeRow));
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

  // 9: a card left for a person is never cancelled by the wall budget
  const ww = await accept(fx("wait-wall"));
  const wwTask = ww.report ? await api(`/api/tasks/${ww.report.task.id}`) : null;
  ok(ww.code === 2 && ww.report?.verdict === "STOP" && /waits for a person/.test(ww.report?.stop?.reason ?? "") && wwTask?.task?.status === "needs-you" && !ww.report?.budget?.cancelled,
    "9: when the wall budget runs out on a card left for a person, the driver stops and leaves the Task for the captain", `${ww.code} ${JSON.stringify(ww.report?.stop)} ${wwTask?.task?.status}`);

  // a pin that is not the served definition stops before anything starts
  const tb = (await api("/api/tasks")).tasks.length;
  const sp = await accept(fx("stale-pin"));
  ok(sp.code === 2 && /re-review the scenario/.test(sp.report?.stop?.reason ?? "") && (await api("/api/tasks")).tasks.length === tb, "a stale definition pin stops before a Task starts", `${sp.code} ${sp.out} ${sp.err}`);

  // 8: the session is scrubbed on real paths: a brief that carries it, an error message that carries it
  const tk = await accept([...fx("accept-pass"), "--topic", `scrub ${token} topic`]);
  ok(tk.code === 0 && tk.mdText.includes("scrub [session] topic") && tk.out.length > 0, "8: a brief carrying the session is written as [session]", tk.mdText.slice(0, 300));
  const pp = await accept([...fx("accept-pass"), "--params", join(root, `missing-${token}.json`)]);
  ok(pp.code === 4 && pp.report?.verdict === "ERROR" && /missing-\[session\]\.json/.test(pp.report?.error ?? "") && !(pp.out + pp.err).includes(token), "8: an error message carrying the session is scrubbed in the report and the output", `${pp.code} ${pp.report?.error} ${pp.out} ${pp.err}`);

  // 7: a transport error after the start: the report is still written and the Task cancelled (Studio restarts under the driver)
  const tBefore = (await api("/api/tasks")).tasks.map((t: any) => t.id);
  const tp = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", base, "--offline-fixture", ...fx("stall")], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
  let tid: string | null = null;
  for (let i = 0; i < 200 && !tid; i++) { await Bun.sleep(100); const t = (await api("/api/tasks")).tasks.find((x: any) => !tBefore.includes(x.id) && x.status === "running"); tid = t?.id ?? null; }
  app.kill("SIGKILL"); await new Promise((r) => app.once("exit", r));
  await Bun.sleep(5000); app = boot(); await waitUp(base, app); // down longer than the driver's 3 s poll, so a request really fails
  const [t1, t2] = await Promise.all([new Response(tp.stdout).text(), new Response(tp.stderr).text()]); const tc = await tp.exited; outputs.push(t1, t2);
  const tjs = /^json: (.+\.json)$/m.exec(t1)?.[1]; const tr = tjs && existsSync(tjs) ? JSON.parse(readFileSync(tjs, "utf8")) : null; if (tjs && existsSync(tjs)) outputs.push(readFileSync(tjs, "utf8"));
  const tTask = tid ? await api(`/api/tasks/${tid}`) : null;
  ok(tid && tc === 4 && tr?.verdict === "ERROR" && tr?.task?.id === tid && /error:/.test((tr?.problems ?? []).join(" ")), "7: a transport error after the start still writes a report (verdict ERROR, exit 4)", `${tid} ${tc} ${t1} ${t2}`);
  ok(tr?.cancel?.cancelled === true && tTask?.status === "cancelled", "7: the started Task is cancelled once Studio answers again", `${JSON.stringify(tr?.cancel)} ${tTask?.status}`);

  // F4: the real number of cancel attempts
  ok(w.report?.cancel?.attempts === 1 && w.report?.cancel?.cancelled === true, "F4: the report gives the real number of cancel attempts", JSON.stringify(w.report?.cancel));

  // F9: the round budget never cancels a Task with a card left for a person
  const tw = await accept(fx("two-wait"));
  const twTask = tw.report?.task ? await api(`/api/tasks/${tw.report.task.id}`) : null;
  ok(tw.code === 2 && /round budget \(1\) ran out while SC-\d+ waits for a person/.test(tw.report?.stop?.reason ?? "") && !tw.report?.budget?.cancelled && !tw.report?.cancel && twTask?.task?.status === "needs-you",
    "F9: when the round budget runs out on a card left for a person, the driver stops and leaves the Task", `${tw.code} ${JSON.stringify(tw.report?.stop)} ${twTask?.task?.status}`);

  // F2: a failed read of the Task is an error: verdict ERROR, the Task cancelled
  const fs1 = await faultyStudio(2);
  const rf = await accept(fx("stall"), fs1.base); fs1.stop();
  const rfTask = rf.report?.task ? await api(`/api/tasks/${rf.report.task.id}`) : null;
  ok(rf.code === 4 && rf.report?.verdict === "ERROR" && /HTTP 503/.test(rf.report?.error ?? "") && rf.report?.cancel?.cancelled === true && rfTask?.status === "cancelled",
    "F2: a non-200 read of the Task is an ERROR (exit 4) and the running Task is cancelled", `${rf.code} ${rf.report?.verdict} ${rf.report?.error} ${JSON.stringify(rf.report?.cancel)} ${rfTask?.status} ${rf.err}`);
  // F9: ... and the error path leaves a card that waits for a person alone
  const fs2 = await faultyStudio(2);
  const re = await accept(fx("transport"), fs2.base); fs2.stop();
  const reTask = re.report?.task ? await api(`/api/tasks/${re.report.task.id}`) : null;
  ok(re.code === 4 && re.report?.verdict === "ERROR" && !re.report?.cancel && (re.report?.problems ?? []).some((p: string) => /waits for a person; the Task is left for the captain/.test(p)) && reTask?.task?.status === "needs-you",
    "F9: the error path does not cancel a Task whose card waits for a person", `${re.code} ${JSON.stringify(re.report?.problems)} ${reTask?.task?.status}`);

  // F7: an open authorization window stops the driver before it answers
  const nonce = (await api("/api/policies/auth-window/confirm")).confirm;
  const grant = await post("/api/policies/auth-window", { confirm: nonce, kinds: ["question"], until: new Date(Date.now() + 3600_000).toISOString(), project: null });
  const aw = await accept(fx("accept-pass"));
  await post("/api/policies/auth-window", { revoke: grant.id });
  ok(grant.id && aw.code === 2 && new RegExp(`authorization window ${grant.id} is open`).test(aw.report?.stop?.reason ?? "") && aw.report?.cards?.every((c: any) => c.decision !== "answered"),
    "F7: with an authorization window open on the run, the driver stops instead of answering", `${JSON.stringify(grant).slice(0, 200)} ${aw.code} ${aw.report?.stop?.reason}`);

  // F3: credential-shaped text in a run error, the brief and the start params never reaches a report or the output
  const ghp = "ghp_" + "Ab1".repeat(10), sk = "sk-" + "Zz9".repeat(8);
  const pf = join(root, "redact-params.json"); writeFileSync(pf, JSON.stringify({ folder: `/nonexistent-acceptance/${ghp}` }));
  const rdx = await accept([...fx("redact"), "--params", pf, "--topic", `redact ${sk} topic`]);
  const rdAll = rdx.out + rdx.err + rdx.mdText + (rdx.js && existsSync(rdx.js) ? readFileSync(rdx.js, "utf8") : "");
  ok(rdx.report && /\[credential removed\]/.test(rdx.report?.run?.error ?? "") && /\[credential removed\]/.test(rdx.mdText) && !rdAll.includes(ghp) && !rdAll.includes(sk),
    "F3: ghp_ and sk- tokens in a run error, the brief and the start params are removed from the report and the output", `${rdx.code} ${rdx.report?.run?.error} ${rdx.err}`);

  // --- no instance: a clear refusal, no sign-in, nothing printed that matters ---
  const other = await freePort();
  const p = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", `http://127.0.0.1:${other}`, ...fx("accept-pass")], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
  const [o1, o2] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); const pc = await p.exited; outputs.push(o1, o2);
  ok(pc === 4 && /No verified running Studio/.test(o1 + o2), "no running Studio at the base: exit 4 with a clear message", o1 + o2);
  const live = Bun.spawn(["bun", "scripts/live-acceptance.ts", "--base", base, ...fx("documents-fail")], { cwd: repo, env: scriptEnv(), stdout: "pipe", stderr: "pipe" });
  const [l1, l2] = await Promise.all([new Response(live.stdout).text(), new Response(live.stderr).text()]); const lc = await live.exited; outputs.push(l1, l2);
  ok(lc === 2 && /stub is not a real model/.test(l1 + l2), "without --offline-fixture a stub provider is refused: live acceptance needs real models", l1 + l2);
  const ljs = /^json: (.+\.json)$/m.exec(l1)?.[1]; const lr = ljs && existsSync(ljs) ? JSON.parse(readFileSync(ljs, "utf8")) : null; if (ljs && existsSync(ljs)) outputs.push(readFileSync(ljs, "utf8"));
  ok(["claude", "codex"].every((v) => lr?.providers?.some((p: any) => p.provider === v)), "B: with agent nodes and no provider on the Start form, every vendor Studio may choose is checked, not the chat setting", JSON.stringify(lr?.providers));
  ok(JSON.stringify(f.report?.usedProviders) === JSON.stringify(["stub/no model"]) && /Used by the run \(per round\): stub\/no model/.test(f.mdText), "B: the report records the provider/model each round really used", JSON.stringify(f.report?.usedProviders));

  // --- no token anywhere ---
  const reports = existsSync(join(data, "acceptance", today)) ? readdirSync(join(data, "acceptance", today)).map((x) => readFileSync(join(data, "acceptance", today, x), "utf8")) : [];
  ok(outputs.length > 10 && reports.length >= 10 && [...outputs, ...reports].every((t) => !t.includes(token)), "no session token in any output or report", String(reports.length));
} finally {
  app.kill("SIGTERM"); await new Promise((r) => app.once("exit", r));
  rmSync(root, { recursive: true, force: true });
}
console.log(`\nlive-acceptance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
