import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The provider contract: every chat provider passes the same checks, so Studio
// does not depend on any one vendor. Claude and Codex run against stub CLIs that
// print each vendor's real output format and call a tool server for real; the
// in-process stub provider runs as is.   bun tests/contract.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedTurn } from "../src/chat";
import { claudeProvider } from "../src/providers/claude";
import { codexProvider } from "../src/providers/codex";
import { stubProvider } from "../src/providers/stub";
import { anthropicProvider, compatProvider, openaiProvider } from "../src/providers/http";
import type { NEvent, Provider } from "../src/providers/types";

const here = import.meta.dir;
const TOKEN = "t".repeat(48);
const calls: string[] = [];
const tools = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const name = new URL(req.url).pathname.replace("/api/tools/", "");
    if (req.headers.get("x-crew-tool-token") !== TOKEN) return new Response(JSON.stringify({ error: "no valid tool token" }), { status: 403 });
    calls.push(name);
    const body = name === "runs_list" ? [{ id: "T-1", status: "done", link: "#/task/T-1" }, { id: "T-2", status: "running", link: "#/task/T-2" }]
      : name === "task_get" ? { id: "T-1", merged: { link: "#/event/7" }, lastEvents: [{ link: "#/event/7" }] }
      : name === "intent_capture" ? { id: "I-009", status: "received", link: "#/intents/I-009" } : { error: "unknown" };
    return Response.json(body);
  },
});
const url = `http://127.0.0.1:${tools.port}`;
const ctx = { studioUrl: url, token: TOKEN, cwd: mkdtempSync(join(tmpdir(), "crew-contract-")), mcpCommand: [process.execPath, join(here, "../src/mcp.ts")],
  env: { ...process.env, CREW_STUDIO_URL: url, CREW_TOOL_TOKEN: TOKEN } as Record<string, string> };
// mock vendor APIs for the direct-HTTP providers: the same scripted behaviour as the stub CLIs
const scenario = (text: string) => /STUB_INTENT/.test(text) ? "intent" : /STUB_TIMEOUT/.test(text) ? "timeout" : /STUB_MANY/.test(text) ? "many" : /STUB_LOGIN/.test(text) ? "login" : "normal";
const answer = "T-1 is done [T-1](#/task/T-1); see [event](#/event/7).";
const apiCalls: string[] = [];
const api = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const path = new URL(req.url).pathname, b: any = await req.json().catch(() => ({}));
  apiCalls.push(path);
  let user = "", round = 0;
  if (path === "/v1/messages") { user = String(b.messages?.[0]?.content ?? ""); round = (b.messages?.length ?? 1) - 1; if (req.headers.get("x-api-key") !== "test-key") return new Response("{}", { status: 401 }); }
  else if (path === "/v1/responses") { user = String(b.input?.[0]?.content ?? ""); round = (b.input ?? []).filter((x: any) => x.type === "function_call_output").length ? 1 : 0; if (req.headers.get("authorization") !== "Bearer test-key") return new Response("{}", { status: 401 }); }
  else if (path === "/compat/v1/chat/completions") { user = String(b.messages?.find((m: any) => m.role === "user")?.content ?? ""); round = (b.messages ?? []).filter((m: any) => m.role === "tool").length ? 1 : 0; }
  const sc = scenario(user);
  if (sc === "login") return new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
  if (sc === "timeout") { await Bun.sleep(8000); }
  const calls = sc === "intent" ? [["intent_capture", { goal: "x" }]] : sc === "many" ? [["runs_list", {}]] : [["runs_list", {}], ["task_get", { id: "T-1" }]];
  const done = (sc === "normal" || sc === "intent") && round > 0;
  const id = (i: number) => `c${round}_${i}`;
  if (path === "/v1/messages") return Response.json({ content: done ? [{ type: "text", text: answer }] : calls.map(([n, a], i) => ({ type: "tool_use", id: id(i), name: n, input: a })), stop_reason: done ? "end_turn" : "tool_use" });
  if (path === "/v1/responses") return Response.json({ output: done ? [{ type: "message", content: [{ type: "output_text", text: answer }] }] : calls.map(([n, a], i) => ({ type: "function_call", call_id: id(i), name: n, arguments: JSON.stringify(a) })) });
  return Response.json({ choices: [{ message: done ? { role: "assistant", content: answer } : { role: "assistant", content: null, tool_calls: calls.map(([n, a], i) => ({ id: id(i), type: "function", function: { name: n, arguments: JSON.stringify(a) } })) } }] });
} });
const apiUrl = `http://127.0.0.1:${api.port}`;
Object.assign(process.env, { CREW_ANTHROPIC_BASE: apiUrl, CREW_OPENAI_BASE: apiUrl, ANTHROPIC_API_KEY: "test-key", OPENAI_API_KEY: "test-key", CREW_COMPAT_BASE_URL: `${apiUrl}/compat/v1` });
const providers: Provider[] = [claudeProvider("stub-model", join(here, "stub-claude.mjs")), codexProvider("stub-model", join(here, "stub-codex.mjs")), stubProvider(),
  anthropicProvider("mock-model"), openaiProvider("mock-model"), compatProvider("mock-model")];

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const collect = async (it: AsyncIterable<NEvent & { guard?: string }>) => { const out: (NEvent & { guard?: string })[] = []; for await (const e of it) out.push(e); return out; };

for (const p of providers) {
  const tag = p.id;
  // 1. stream order and tool events
  const ev = await collect(guardedTurn(p, "How is it going?", ctx, { timeoutMs: 15_000 }));
  const ends = ev.filter((e) => e.type === "turnEnd");
  ok(ends.length === 1 && ev.at(-1)?.type === "turnEnd" && (ev.at(-1) as any).status === "ok", `${tag}: one turnEnd, last, status ok`, JSON.stringify(ends));
  const starts = ev.filter((e) => e.type === "toolStart") as Extract<NEvent, { type: "toolStart" }>[];
  const endsT = ev.filter((e) => e.type === "toolEnd") as Extract<NEvent, { type: "toolEnd" }>[];
  ok(starts.length >= 2 && starts.length === endsT.length, `${tag}: every tool call starts and ends`, `${starts.length}/${endsT.length}`);
  ok(endsT.every((e) => ev.findIndex((x) => x.type === "toolStart" && x.id === e.id) < ev.indexOf(e)), `${tag}: a toolEnd follows its toolStart`);
  ok(starts.every((s) => /^[a-z_]+$/.test(s.name) && typeof s.args === "object"), `${tag}: tool names are plain Studio names with object args`, starts.map((s) => s.name).join(","));
  ok(endsT[0]?.rows === 2 && endsT.every((e) => e.error === null), `${tag}: toolEnd carries a row count`, JSON.stringify(endsT.map((e) => e.rows)));
  const text = ev.filter((e) => e.type === "delta").map((e: any) => e.text).join("");
  ok(/\[T-1\]\(#\/task\/T-1\)/.test(text) && ev.some((e) => e.type === "message"), `${tag}: text streams as deltas plus a message, with a citation`);
  const lastTool = ev.map((e) => e.type).lastIndexOf("toolEnd"), firstText = ev.findIndex((e) => e.type === "delta");
  ok(firstText > lastTool, `${tag}: the answer comes after its lookups`);
  // 2. an intent is captured through the same tool route
  const iv = await collect(guardedTurn(p, "STUB_INTENT", ctx, { timeoutMs: 15_000 }));
  ok(iv.some((e) => e.type === "toolEnd" && /"I-009"/.test(e.result)) && (iv.at(-1) as any).status === "ok", `${tag}: intent_capture goes through the tool route`);
  // 3. timeout: the guard interrupts and the stream ends promptly
  let t0 = Date.now();
  const tv = await collect(guardedTurn(p, "STUB_TIMEOUT", ctx, { timeoutMs: 1200 }));
  ok(tv.at(-1)?.type === "turnEnd" && (tv.at(-1) as any).status === "interrupted" && (tv.at(-1) as any).guard === "timeout" && Date.now() - t0 < 6000,
    `${tag}: a turn past its time limit ends as interrupted by timeout`, `${Date.now() - t0}ms ${JSON.stringify(tv.at(-1))}`);
  // 4. interrupt mid-turn
  const s = p.start("sys", [], ctx);
  const seen: NEvent[] = [];
  t0 = Date.now();
  for await (const e of s.send("STUB_MANY")) { seen.push(e); if (e.type === "toolStart" && seen.filter((x) => x.type === "toolStart").length === 2) s.interrupt(); }
  ok(seen.at(-1)?.type === "turnEnd" && (seen.at(-1) as any).status === "interrupted" && seen.filter((x) => x.type === "toolStart").length < 10 && Date.now() - t0 < 5000,
    `${tag}: interrupt() ends the turn as interrupted`, JSON.stringify(seen.at(-1)));
  // 5. the tool-call limit
  const mv = await collect(guardedTurn(p, "STUB_MANY", ctx, { timeoutMs: 15_000, maxTools: 3 }));
  ok((mv.at(-1) as any).guard === "tooManyTools" && mv.filter((e) => e.type === "toolStart").length <= 3, `${tag}: the tool-call limit stops the turn`);
  // 6. a logged-out provider is reported as such
  const lv = await collect(guardedTurn(p, "STUB_LOGIN", ctx, { timeoutMs: 15_000 }));
  ok((lv.at(-1) as any).status === "error" && (lv.at(-1) as any).code === "notLoggedIn", `${tag}: a logged-out provider reports notLoggedIn`, JSON.stringify(lv.at(-1)));
}
// a direct-HTTP provider with no key says so instead of calling out
{ const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const nk = await collect(guardedTurn(anthropicProvider("x"), "hi", ctx, { timeoutMs: 5000 }));
  ok((nk.at(-1) as any)?.status === "error" && (nk.at(-1) as any)?.code === "notLoggedIn" && /API key/.test((nk.at(-1) as any)?.message), "anthropic: no key is a clean notLoggedIn error, no request sent", JSON.stringify(nk.at(-1)));
  process.env.ANTHROPIC_API_KEY = saved; }
// an unreachable endpoint is a clean error
{ const saved = process.env.CREW_COMPAT_BASE_URL; process.env.CREW_COMPAT_BASE_URL = "http://127.0.0.1:9/v1";
  const un = await collect(guardedTurn(compatProvider("x"), "hi", ctx, { timeoutMs: 5000 }));
  ok((un.at(-1) as any)?.status === "error" && (un.at(-1) as any)?.code === "cliUnavailable", "openai-compatible: an unreachable endpoint ends cleanly", JSON.stringify(un.at(-1)));
  process.env.CREW_COMPAT_BASE_URL = saved; }
ok(apiCalls.every((p) => p.startsWith("/v1/") || p.startsWith("/compat/")), "direct-HTTP providers only call their configured base URL");
api.stop(true);
// a missing CLI is a clean error, not a crash
const gone = await collect(guardedTurn(claudeProvider("x", "/nonexistent/claude-cli"), "hi", ctx, { timeoutMs: 5000 }));
ok((gone.at(-1) as any)?.status === "error", "a missing CLI ends the turn with an error", JSON.stringify(gone.at(-1)));
tools.stop(true);
console.log(`\ncontract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0); // the stub provider's timeout case leaves a long sleep behind
