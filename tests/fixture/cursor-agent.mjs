// Strict offline cursor-agent fixture (tests/acceptance.ts with ACCEPTANCE_PROVIDER=cursor, tests/cursor-vendor.ts).
// No real vendor, login, network or config access. It answers only to the acceptance key (CURSOR_API_KEY starting
// crsr_acceptance); anything else is "not logged in", as the real CLI says without a key.
//   --version                   a fixture version (no key needed, as with the real CLI)
//   create-chat                 prints a new chat id
//   -p --output-format stream-json --workspace W … <text>
//     Firstmate (W/.cursor/mcp.json's studio server reaches a native socket): the scripted Firstmate turns of
//     tests/fixture/codex-account.mjs, its tools over that MCP server; otherwise a worker or reviewer round, the shared
//     scripted agent (tests/acceptance/agent.mjs cursorPrint).
// Every -p run refuses a cli-config.json that does not deny the built-in Shell, Read and Write tools.
//   CURSOR_FIXTURE_LOG  a file each run appends its argv (without the prompt) and chat id to (tests/cursor-vendor.ts)
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cursorPrint, mcpSession } from "../acceptance/agent.mjs";

const argv = process.argv.slice(2), key = process.env.CURSOR_API_KEY ?? "";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const get = (k) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined;
const fail = (text, code = 1) => { out({ type: "result", subtype: "error", is_error: true, result: text }); process.exit(code); };
if (argv.length === 1 && argv[0] === "--version") { console.log("2026.10.01-fixture"); process.exit(0); }
if (!/^crsr_acceptance[A-Za-z0-9]+$/.test(key)) fail("Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY.");
const log = (o) => { if (process.env.CURSOR_FIXTURE_LOG) appendFileSync(process.env.CURSOR_FIXTURE_LOG, JSON.stringify(o) + "\n"); };
if (argv[0] === "create-chat") { const id = randomUUID(); log({ argv, chat: id }); console.log(id); process.exit(0); }
if (argv[0] !== "-p" || get("--output-format") !== "stream-json" || !get("--workspace") || !argv.includes("--trust")) fail(`cursor-agent fixture: unexpected argv ${JSON.stringify(argv.slice(0, -1))}`, 2);
let perms = null;
try { perms = JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "/nonexistent", ".config"), "cursor", "cli-config.json"), "utf8")).permissions; } catch {}
if (!["Shell(*)", "Read(**)", "Write(**)"].every((d) => perms?.deny?.includes(d))) fail("cursor-agent fixture: cli-config.json does not deny the built-in tools", 2);
let server = null;
try { server = JSON.parse(readFileSync(join(get("--workspace"), ".cursor", "mcp.json"), "utf8")).mcpServers.studio; } catch {}
if (!server) fail("cursor-agent fixture: no studio MCP server in the workspace's .cursor/mcp.json", 2);
if (!server.env?.CREW_STUDIO_SOCKET) { await cursorPrint(argv); process.exit(process.exitCode ?? 0); }

// ---------- Firstmate (host) turn ----------
const session_id = get("--resume") ?? randomUUID(), model = get("--model") ?? "composer-2.5";
log({ argv: argv.slice(0, -1), chat: session_id, home: process.env.HOME });
const text = argv.at(-1).replace(/(?:\n\n\[Studio note: [^\n]*\])+$/, "");
out({ type: "system", subtype: "init", apiKeySource: "env", cwd: get("--workspace"), session_id, model, permissionMode: "default" });
const say = (t) => out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] }, session_id });
const ask = (q, escalate, extra = {}) => ({ name: "studio_answer_agent_question", args: { task: q[1], node: q[2], visit: Number(/visit:(\d+)/.exec(text)?.[1]), escalate, ...extra } });
let tool = null;
try {
  const marker = ["NATIVE-TOOL ", "NATIVE-STAFFING ", "NATIVE-PROJECT ", "NATIVE-PROPOSE "].find((m) => text.includes(m));
  if (marker) {
    const args = JSON.parse(text.slice(text.indexOf(marker) + marker.length));
    tool = marker === "NATIVE-TOOL " || marker === "NATIVE-STAFFING " ? args : { name: marker === "NATIVE-PROJECT " ? "studio_prepare_project_work" : "studio_propose_work", args };
  } else if (text.includes("Agent question in Task ") && /discount/.test(text)) tool = ask(/Task (R-\d+), step ([a-z-]+)/.exec(text), "The discount percentage is a captain preference that I cannot infer.");
  else if (text.includes("Escalation in Task ")) tool = ask(/Task (R-\d+), step ([a-z-]+)/.exec(text), "The worker needs work outside the approved scope; only the captain can widen it.", { recommendation: "Rescope to include it, or park the Task." });
} catch {}
if (text.includes("You are Studio's own Firstmate")) say("Hello! I am your Studio Firstmate. What would you like to make?");
if (tool) {
  const call_id = "fixture-call-1", allowed = perms.allow?.includes(`Mcp(studio:${tool.name})`);
  const event = (subtype, result) => out({ type: "tool_call", subtype, call_id, tool_call: { mcpToolCall: { args: { name: `studio-${tool.name}`, args: tool.args, toolName: tool.name, providerIdentifier: "studio" }, ...(result ? { result } : {}) } }, session_id });
  event("started");
  if (!allowed) event("completed", { rejected: { reason: `Mcp(studio:${tool.name}) is not allowed` } });
  else {
    const mcp = mcpSession(server);
    try {
      await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cursor-agent-fixture", version: "1" } });
      const r = await mcp.rpc("tools/call", { name: tool.name, arguments: tool.args });
      const body = (r.result?.content ?? []).map((c) => c?.text ?? "").join("") || String(r.error?.message ?? "");
      event("completed", { success: { content: [{ text: { text: body } }], isError: !!r.result?.isError || !!r.error } });
    } finally { mcp.close(); }
  }
}
out({ type: "result", subtype: "success", is_error: false, result: "", session_id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
