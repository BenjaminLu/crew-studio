import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Contract fidelity (fix round 1, runtime class "contract", check-runtime#1, #2, #9):
// the verdict set is exactly pass|fail|warn|error; an adapter whose command is not
// declared is an error, never a silent pass; a judged check blocks only with a
// quorum of n ≥ 2 of ≥ n; every node kind has a runner (loop included) and a graph
// whose kind has none is refused; the run stream reaches the browser over SSE;
// every card is STE-checked by a check that exists, and a zh-TW section that is not
// Chinese is flagged; the captain opens an authorization window in Studio.
//   bun tests/fidelity.ts
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
import { freePort, waitUp } from "./boot.mjs";
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const { ok, end } = suite("fidelity");
const { parseOutput } = await import("../src/runtime/checks");
const { quorumOk } = await import("../src/runtime/engine");
const { validate, normalize } = await import("../src/runtime/defs");

ok(parseOutput('{"verdict":"skip"}', "x").verdict === "error", "a verdict outside pass|fail|warn|error is error");
ok(!quorumOk({ n: 1, of: 2 }) && !quorumOk({ n: 2, of: 1 }) && !quorumOk(null) && quorumOk({ n: 2, of: 3 }) && quorumOk({ n: 2, of: 2 }), "a quorum is n ≥ 2 votes of ≥ n runs");

const H = await harness([
  Y({ id: "ck", name: "ck", roles: [], nodes: [{ id: "k", kind: "check", label: "K", checks: [{ use: "t/skipper" }], x: 0, y: 0 }, { id: "ok", kind: "hook", label: "OK", x: 1, y: 0 }, { id: "no", kind: "hook", label: "No", args: { result: "blocked" }, x: 1, y: 1 }], edges: [["k", "ok", "pass"], ["k", "no", "fail"]] }),
  Y({ id: "ad", name: "ad", roles: [], nodes: [{ id: "k", kind: "check", label: "K", checks: [{ use: "t/undeclared" }], x: 0, y: 0 }, { id: "ok", kind: "hook", label: "OK", x: 1, y: 0 }, { id: "no", kind: "hook", label: "No", args: { result: "blocked" }, x: 1, y: 1 }], edges: [["k", "ok", "pass"], ["k", "no", "fail"]] }),
  Y({ id: "jq", name: "jq", roles: [], nodes: [{ id: "k", kind: "check", label: "K", checks: [{ use: "t/judge2", quorum: { n: 1, of: 2 } }, { use: "t/judge2" }], x: 0, y: 0 }, { id: "ok", kind: "hook", label: "OK", x: 1, y: 0 }, { id: "no", kind: "hook", label: "No", args: { result: "blocked" }, x: 1, y: 1 }], edges: [["k", "ok", "pass"], ["k", "no", "fail"]] }),
  Y({ id: "card", name: "card", roles: [], nodes: [{ id: "q", kind: "card", label: "Q", card: { body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, title: "Ship it?", options: [{ id: "go", label: "Go", labelZh: "Go" }] }, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["q", "e", "go"]] }),
], { refine: true });
const E = H.engine;
const done = (id: string) => until(() => ["succeeded", "failed", "waiting"].includes(E.get(id)!.status), 30000);
{ const r = E.start({ workflow: "ck", text: "x" }); await done(r.id);
  ok(E.get(r.id)!.result === "blocked" && E.ledger(r.id)[0].verdict === "error", "a blocking check that answers skip is an error and blocks"); }
{ const r = E.start({ workflow: "ad", text: "x" }); await done(r.id);
  ok(E.get(r.id)!.result === "blocked" && /not declared/.test(E.ledger(r.id)[0].error ?? ""), "an adapter whose command is not declared here is an error and blocks", E.ledger(r.id)[0].error ?? ""); }
{ const r = E.start({ workflow: "jq", text: "x" }); await done(r.id);
  const L = E.ledger(r.id); const weak = L.find((e) => (e as any).votes?.length === 2)!, strong = L.find((e) => (e as any).votes?.length === 3)!;
  ok(weak && !weak.blocking && strong && strong.blocking && strong.verdict === "fail" && E.get(r.id)!.result === "blocked", "a judged check with 1 of 2 never blocks; with 2 of 3 failing votes it blocks"); }
// every kind has a runner; a graph whose kind has no runner is refused
const loopy = normalize({ id: "lp", name: "lp", roles: [{ id: "w", label: "W", skill: "x" }], nodes: [{ id: "s", kind: "hook", label: "S", do: "set", x: 0, y: 0 }, { id: "a", kind: "agent", label: "A", role: "w", mode: "test", x: 0, y: 0 }, { id: "l", kind: "loop", label: "L", args: { producer: "a" }, x: 0, y: 1 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["s", "a"], ["a", "e", "ok"], ["a", "l", "fail"], ["l", "a", "retry"], ["l", "e", "pass"]] });
const runners = new Set(Object.keys(E.kinds));
ok(["agent", "check", "card", "loop", "hook"].every((k) => runners.has(k)), "every node kind of §3.1 has a runner, loop included");
ok(validate(loopy, undefined, runners).filter((p) => p.level === "error").length === 0 && validate(loopy, undefined, new Set(["agent", "hook"])).some((p) => /no runner for the loop kind/.test(p.text)), "a graph whose kind has no runner is refused");
// every card is STE-checked by a check that exists; English in a zh-TW section is flagged
{ const r = E.start({ workflow: "card", text: "ship it" }); await done(r.id);
  const c = E.cards.list({ run: r.id })[0]; const ste = E.ledger(r.id).find((e) => e.check === "core/ste-wording")!;
  ok(c?.ste?.seq === ste?.seq && !!E.registry.get("core/ste-wording"), "a card is STE-checked by core/ste-wording, a check that exists, and the result is on the card");
  ok(ste?.findings.some((f) => f.class === "ste-locale" && /zh-TW/.test((f.locator as any)?.section ?? "")), "a zh-TW section that is not Chinese is flagged"); }
H.stop();

// the server: the run stream over SSE, and the captain's authorization window route
const tmp = mkdtempSync(join(tmpdir(), "crew-fid-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data"); mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), "");
mkdirSync(join(data, "workflows", "ask"), { recursive: true });
writeFileSync(join(data, "workflows", "ask", "v1.json"), JSON.stringify({ id: "ask", name: "Ask", version: 1, roles: [], nodes: [{ id: "q", kind: "card", label: "Q", x: 0, y: 0, card: { body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, title: "Go?", options: [{ id: "go", label: "Go", labelZh: "Go" }] } }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [{ from: "q", to: "e", when: "go" }] }));
const port = await freePort();
const env: any = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data, CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
try {
  const ac = new AbortController(); let streamed = "";
  const sse = fetch(base + "/api/stream", { signal: ac.signal }).then(async (r) => { const rd = r.body!.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; streamed += dec.decode(value); } }).catch(() => {});
  await sleep(300);
  const post = async (p: string, b: any) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const st = await post("/api/wruns", { workflow: "ask", text: "go" });
  await until(() => /event: wrun/.test(streamed) && /"type":"node"/.test(streamed), 6000);
  ok(st.status === 200 && /event: wrun/.test(streamed) && streamed.includes(st.body.id), "a run's transitions reach the browser over SSE (/api/stream, event wrun)", `${st.status} ${JSON.stringify(st.body).slice(0, 200)} ${log.slice(-400)}`);
  const noConfirm = await post("/api/policies/auth-window", { kinds: ["merge"], until: "2099-01-01T00:00:00Z" });
  const conf = await (await fetch(base + "/api/policies/auth-window/confirm")).json();
  const g = await post("/api/policies/auth-window", { kinds: ["merge"], until: "2099-01-01T00:00:00Z", confirm: conf.confirm });
  const reuse = await post("/api/policies/auth-window", { kinds: ["merge"], until: "2099-01-01T00:00:00Z", confirm: conf.confirm });
  const bad = await post("/api/policies", { patch: { auth: { window: { kinds: ["merge"], until: "2099-01-01T00:00:00Z" } } } });
  ok(noConfirm.status === 403 && g.status === 200 && /^G-/.test(g.body.id) && g.body.granted_by === "captain (desktop)" && reuse.status === 403 && bad.status === 400, "the captain opens a window in Studio with a fresh one-time confirmation; without it, or reusing it, or by a policy patch, nothing opens", JSON.stringify([noConfirm.status, g.status, reuse.status, bad.status]));
  ac.abort(); await sse;
} catch (e) { ok(false, "server checks", String(e) + log.slice(-800)); }
finally { app.kill(); }
end();
