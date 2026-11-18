import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A Claude round that fails says why (src/providers/claude.ts): the canned sentence stays, and after it a short reason built
// from the CLI's own event (type and subtype, API status, error, result text) or from the exit code and stderr tail, redacted
// and clipped. The classification and the invalidation are unchanged: every failure still fails closed. One exception: a reply
// longer than the CLI's output cap is outputLimit, which ends the turn but never invalidates readiness, and Studio's rounds
// hand the CLI a higher cap (CLAUDE_CODE_MAX_OUTPUT_TOKENS, from CREW_CLAUDE_MAX_OUTPUT_TOKENS).
//                                                                                    bun tests/claude-failure-reason.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeParser, claudeProvider } from "../src/providers/claude";
import { claudeFailureCode, nativeClaude } from "../src/providers/claude-native";
import { suite } from "./rt-harness";
const { ok, end } = suite("claude-failure-reason");

const MODEL = "claude-test-model", TOOLS = [{ name: "read" }] as any[];
const fresh = () => { const seen: string[] = []; const approved = { model: MODEL, effort: null, invalidate: (code: string) => { seen.push(code); } } as any;
  const p = claudeParser(approved, TOOLS); p.line({ type: "system", subtype: "init", model: MODEL, tools: ["mcp__studio__read"], mcp_servers: [{ name: "studio" }] }); return { p, seen }; };
const errEnd = (evs: any[] | any) => [evs].flat().find((e: any) => e?.type === "turnEnd" && e.status === "error");

// a result the CLI marks as an error: its subtype and its text come along
{ const { p, seen } = fresh();
  const e = errEnd(p.line({ type: "result", subtype: "error_during_execution", is_error: true, result: "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}" }));
  ok(e?.code === "cliError" && seen.join() === "cliError", "an error result is still cliError and still invalidates readiness", JSON.stringify({ e, seen }));
  ok(/^The Claude CLI reported an error; readiness was invalidated\. Reason: /.test(e?.message ?? "") && /error_during_execution/.test(e.message) && /529/.test(e.message), "its message says the CLI reported an error, then the subtype and the 529", e?.message);
  ok(!/authentication/.test(e?.message ?? ""), "a non-auth failure no longer blames authentication", e?.message);
  ok(p.line({ type: "assistant", message: { model: MODEL, content: [] } }).length === 0, "after the failure the parser stays closed"); }

// an API error event with a status and an error object
{ const { p } = fresh(); const e = errEnd(p.line({ type: "result", subtype: "error_max_turns", is_error: true, api_error_status: 500, error: { type: "api_error", message: "Internal  server\n error" } }));
  ok(e?.code === "cliError" && /Reason: result error_max_turns: API status 500; api_error Internal server error/.test(e.message), "the API status and the error's type and message, whitespace collapsed", e?.message); }

// a non-zero exit: the exit code and a redacted stderr tail, never the token
{ const { p, seen } = fresh(); const token = "sk-ant-api03-FAKEFAKEFAKE1234567890";
  const e = p.exit!(1, `starting\nrequest failed with x-api-key: ${token}\nAuthorization: Bearer ${token}\nfatal: stream closed / retry later\n`) as any;
  ok(e?.code === "cliError" && seen.join() === "cliError", "a non-zero exit is still cliError and invalidates readiness", JSON.stringify({ e, seen }));
  ok(/Reason: exit 1, no result; stderr: /.test(e?.message ?? "") && /stream closed/.test(e.message), "its message has the exit code and the stderr tail", e?.message);
  ok(!e?.message.includes(token) && !e?.message.includes("FAKEFAKE"), "the token in stderr never reaches the message", e?.message);
  ok(!e?.message.includes(" / "), "a \" / \" in stderr cannot split the message into two languages", e?.message); }

// a long stderr is clipped
{ const { p } = fresh(); const e = p.exit!(2, "x".repeat(5000)) as any;
  ok(e?.code === "cliError" && e.message.length < 520 && /exit 2/.test(e.message), "a long stderr is clipped", String(e?.message.length)); }

// not logged in keeps its code and its auth wording
{ const { p, seen } = fresh(); const e = errEnd(p.line({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }));
  ok(e?.code === "notLoggedIn" && seen.join() === "notLoggedIn" && /^Claude authentication or execution was refused; readiness was invalidated\. Reason: result success: Not logged in/.test(e.message), "notLoggedIn keeps its code and wording, with the reason after", JSON.stringify(e)); }
{ const { p } = fresh(); const e = p.exit!(1, "Invalid API key · Please run /login") as any;
  ok(e?.code === "notLoggedIn" && /^Claude authentication or execution was refused; readiness was invalidated\. Reason: exit 1/.test(e.message), "a login failure on exit is notLoggedIn with its exit reason", JSON.stringify(e)); }

// quota keeps its own message untouched
{ const { p } = fresh(); const e = errEnd(p.line({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }));
  ok(e?.code === "quotaExhausted" && !/Reason:/.test(e.message), "quota keeps its own message", JSON.stringify(e)); }

// the model's text is never part of a reason
{ const { p } = fresh(); const e = errEnd(p.line({ type: "assistant", message: { model: MODEL, content: "secret prompt text" } }));
  ok(e?.code === "cliError" && !/secret prompt text/.test(e.message) && /malformed message content/.test(e.message), "a malformed assistant event names the problem, not its text", e?.message); }

// a clean run ends ok with no reason
{ const { p } = fresh(); const evs = p.line({ type: "result", subtype: "success", is_error: false, result: "done", modelUsage: { [MODEL]: {} } });
  ok(evs.some((e: any) => e.type === "turnEnd" && e.status === "ok") && p.exit!(0, "") === null, "a successful result and a clean exit stay ok", JSON.stringify(evs)); }

// a reply past the CLI's output cap: its own code, its cap named, and readiness kept
const CUT = { type: "result", subtype: "success", is_error: true, api_error_status: null, result: "API Error: Claude's response exceeded the 300 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable." };
{ const { p, seen } = fresh(); const e = errEnd(p.line(CUT));
  ok(claudeFailureCode(CUT) === "outputLimit" && e?.code === "outputLimit", "a reply past the output cap is outputLimit", JSON.stringify(e));
  ok(seen.length === 0, "outputLimit never invalidates readiness", JSON.stringify(seen));
  ok(/exceeded the 300-token output limit/.test(e?.message ?? "") && /300 token 的輸出上限/.test(e.message), "its message names the cap, in both languages", e?.message);
  ok(p.exit!(1, "") === null && seen.length === 0, "the CLI's non-zero exit after it adds no refusal", JSON.stringify(seen)); }
{ const saved = nativeClaude.invalidate; const calls: string[] = []; (nativeClaude as any).invalidate = (c: string) => { calls.push(c); };
  try { nativeClaude.observe(CUT); nativeClaude.observe({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom" }); } finally { (nativeClaude as any).invalidate = saved; }
  ok(calls.join() === "cliError", "a host event at the output cap is observed without invalidating; a real CLI error still invalidates", JSON.stringify(calls)); }
ok(claudeFailureCode({ ...CUT, api_error_status: 400 }) !== "outputLimit" && claudeFailureCode({ ...CUT, is_error: false }) === null && claudeFailureCode({ type: "assistant", is_error: true, result: CUT.result }) === "cliError", "only an error result with that text and no API status is outputLimit (narrow)");

// the spawned CLI gets Studio's output cap, overridable within bounds
{ const dir = mkdtempSync(join(tmpdir(), "crew-claude-cap-")), stub = join(dir, "stub.mjs"), tokenFile = join(dir, "token"); writeFileSync(tokenFile, "t");
  writeFileSync(stub, [
    `const a = process.argv.slice(2), o = (x) => process.stdout.write(JSON.stringify(x) + "\\n");`,
    `o({ type: "system", subtype: "init", model: "m", tools: (a[a.indexOf("--allowedTools") + 1] || "").split(",").filter(Boolean), mcp_servers: [{ name: "studio" }] });`,
    `if (a.includes("CUT")) { o(${JSON.stringify(CUT)}); process.exit(1); }`,
    `o({ type: "result", subtype: "success", is_error: false, result: "cap=" + (process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? "none") });`].join("\n"));
  const turn = async (text: string, env: Record<string, string> = {}) => { const s = claudeProvider("m", stub).start("sys", TOOLS, { studioUrl: "http://127.0.0.1:9", token: "t", tokenFile, cwd: dir, mcpCommand: ["true"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env } });
    const evs: any[] = []; for await (const e of s.send(text)) evs.push(e); return evs; };
  const said = (evs: any[]) => evs.filter((e) => e.type === "delta").map((e) => e.text).join("");
  const saved = process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS;
  try {
    delete process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS; let evs = await turn("hi", { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "300" });
    ok(said(evs) === "cap=64000", "the CLI runs with a 64000-token output cap by default, whatever the round's env carried", JSON.stringify(evs.at(-1)));
    process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS = "100000"; ok(said(await turn("hi")) === "cap=100000", "CREW_CLAUDE_MAX_OUTPUT_TOKENS sets it");
    process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS = "999999999"; ok(said(await turn("hi")) === "cap=64000", "an out-of-bounds value falls back to the default");
    delete process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS; evs = await turn("CUT");
    ok(evs.at(-1)?.type === "turnEnd" && evs.at(-1)?.code === "outputLimit", "a CLI that stops at its output cap ends the turn as outputLimit, through the real process session", JSON.stringify(evs.at(-1)));
  } finally { if (saved === undefined) delete process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS; else process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS = saved; } }
end();
