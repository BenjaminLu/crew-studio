// A stand-in for a long-lived `claude -p --resume <id> --input-format stream-json
// --output-format stream-json` in tests: no model is called. It reads captain
// turns from stdin, writes the session file under $HOME/.claude/projects like
// claude does, and prints claude's stream-json shapes. The message picks the
// behaviour: STUB_TOOL (asks permission through the real permission MCP server
// from --mcp-config), STUB_SLOW (streams until interrupted), otherwise an echo.
// A session id starting with "fork-" is re-identified as "<id>-new" on init.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
// a fresh session names its own id (--session-id); otherwise the one to resume
const want = argv.includes("--session-id") ? argv[argv.indexOf("--session-id") + 1] : argv[argv.indexOf("--resume") + 1];
if (argv.includes("--dangerously-skip-permissions") || argv.includes("bypassPermissions")) { console.error("stub: refuses bypass"); process.exit(9); }
const id = argv.includes("--fork-session") ? `${want}-copy` : want.startsWith("fork-") ? `${want}-new` : want;
if (process.env.STUB_ARGV_FILE) appendFileSync(process.env.STUB_ARGV_FILE, JSON.stringify({ argv, FM_IN_ROUND: process.env.FM_IN_ROUND ?? null, pid: process.pid,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null, oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ? (process.env.CLAUDE_CODE_OAUTH_TOKEN === process.env.STUB_EXPECT_CREW ? "expected" : "other") : null }) + "\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const touch = (o) => appendFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ ...o, sessionId: id, cwd: process.cwd(), isSidechain: false }) + "\n");
// like the CLI: --mcp-config takes inline JSON or a file path
const mcpArg = argv.includes("--mcp-config") ? argv[argv.indexOf("--mcp-config") + 1] : null;
const mcpCfg = mcpArg ? JSON.parse(mcpArg.trim().startsWith("{") ? mcpArg : readFileSync(mcpArg, "utf8")) : null;
let inited = false, interrupted = false, slow = false;

/** One stdio MCP server from --mcp-config, as the CLI runs it: initialize, then the given calls in order. */
async function mcpSession(server, calls) {
  const p = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: p.stdout });
  const replies = new Map();
  rl.on("line", (l) => { try { const m = JSON.parse(l); replies.get(m.id)?.(m); } catch {} });
  const call = (id, method, params) => new Promise((r) => { replies.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await call(1, "initialize", { protocolVersion: "2025-06-18" });
  const out = [];
  for (let i = 0; i < calls.length; i++) out.push(await call(i + 2, calls[i].method, calls[i].params));
  p.kill();
  return out;
}

async function askPermission(name, input) {
  const s = mcpCfg?.mcpServers?.studio_permission ?? Object.values(mcpCfg?.mcpServers ?? {})[0];
  if (!s) return { behavior: "deny", message: "no permission tool" };
  const p = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: p.stdout });
  const replies = new Map();
  rl.on("line", (l) => { try { const m = JSON.parse(l); replies.get(m.id)?.(m); } catch {} });
  const call = (id, method, params) => new Promise((r) => { replies.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await call(1, "initialize", { protocolVersion: "2025-06-18" });
  const r = await call(2, "tools/call", { name: "approve", arguments: { tool_name: name, input, tool_use_id: "toolu_perm_1" } });
  p.kill();
  return JSON.parse(r.result.content[0].text);
}

// the CLI reports the mode it actually runs in at init: the requested --permission-mode, unless a knob says Claude fell back
// (STUB_EFFECTIVE_MODE, or the file named by STUB_EFFECTIVE_MODE_FILE, read when the session starts)
const requestedMode = argv.includes("--permission-mode") ? argv[argv.indexOf("--permission-mode") + 1] : "default";
const knobMode = (() => { try { const f = process.env.STUB_EFFECTIVE_MODE_FILE; if (f && existsSync(f)) return readFileSync(f, "utf8").trim(); } catch {} return process.env.STUB_EFFECTIVE_MODE || ""; })();
const effectiveMode = () => knobMode || requestedMode;

async function turn(text, files = []) {
  if (!inited && process.env.STUB_SEED_FILE) appendFileSync(process.env.STUB_SEED_FILE, JSON.stringify({ seed: text, pid: process.pid }) + "\n");
  if (!inited) { inited = true; out({ type: "system", subtype: "init", session_id: id, model: "stub-opus", tools: [], permissionMode: effectiveMode() }); }
  touch({ type: "user", message: { role: "user", content: text } });
  // Studio's one-line note after the captain's words (reply in their language and script): the model reads it, it is not the message
  text = text.replace(/\n\n\[Studio note: [^\n]*\]$/, "");
  if (text.includes("STUB_NATIVE ")) {
    // STUB_NATIVE <tool> <json args>: list Studio's tools over its MCP helper, then call one, as the CLI would for mcp__studio__<tool>
    const rest = text.slice(text.indexOf("STUB_NATIVE ") + 12), sp = rest.indexOf(" "), tool = sp < 0 ? rest : rest.slice(0, sp);
    let args = {}; try { args = JSON.parse(sp < 0 ? "{}" : rest.slice(sp + 1)); } catch {}
    const server = mcpCfg?.mcpServers?.studio;
    const allowed = argv.includes("--allowedTools") ? argv[argv.indexOf("--allowedTools") + 1].split(",") : [];
    let say;
    if (!server) say = "no studio MCP server";
    else if (!allowed.includes(`mcp__studio__${tool}`)) { const a = await askPermission(`mcp__studio__${tool}`, args); say = a.behavior === "allow" ? "permitted by the bridge" : `Not allowed: ${a.message}`; }
    else {
      out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_native", name: `mcp__studio__${tool}`, input: args }] } });
      const [list, called] = await mcpSession(server, [{ method: "tools/list", params: {} }, { method: "tools/call", params: { name: tool, arguments: args } }]);
      const names = (list.result?.tools ?? []).map((t) => t.name);
      out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_native", content: called.result?.content ?? [], is_error: !!called.result?.isError }] } });
      say = `native tools: ${names.join(",")} | ${tool} ${called.result?.isError ? "error" : "ok"}: ${(called.result?.content ?? []).map((c) => c.text ?? "").join("").slice(0, 3000)}`;
    }
    out({ type: "result", subtype: "success", is_error: false, result: say });
  } else if (text.includes("STUB_API_ERROR ")) {
    // an API error the CLI reports as a failed result, in its own words
    out({ type: "result", subtype: "success", is_error: true, api_error_status: 500, result: text.slice(text.indexOf("STUB_API_ERROR ") + 15).split("\n")[0] });
  } else if (text.includes("STUB_EXIT")) {
    process.stderr.write("stub claude: fatal: connection to the API was closed unexpectedly\n"); process.exit(3);
  } else if (text.includes("STUB_QUOTA")) {
    out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
    out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude usage limit reached" });
  } else if (text.includes("STUB_TOOL")) {
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la" } }] } });
    const a = await askPermission("Bash", { command: "ls -la" });
    out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: a.behavior === "allow" ? "ok" : a.message, is_error: a.behavior !== "allow" }] } });
    const say = a.behavior === "allow" ? "Ran ls." : `Not allowed: ${a.message}`;
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: say } } });
    out({ type: "result", subtype: "success", is_error: false, result: say });
  } else if (text.includes("STUB_ASK")) {
    const input = { questions: [{ question: "Which shard budget?", header: "Budget", multiSelect: false, options: [{ label: "540s", description: "tighter" }, { label: "600s", description: "as now" }] }] };
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_q", name: "AskUserQuestion", input }] } });
    const a = await askPermission("AskUserQuestion", input);
    const say = a.behavior === "allow" ? `answered: ${JSON.stringify(a.updatedInput?.answers ?? null)}` : `no answer: ${a.message}`;
    out({ type: "result", subtype: "success", is_error: false, result: say });
  } else if (text.includes("STUB_SLOW")) {
    slow = true; interrupted = false;
    for (let i = 0; i < 300 && !interrupted; i++) { out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "." } } }); await sleep(50); }
    slow = false;
    out({ type: "result", subtype: interrupted ? "error_during_execution" : "success", is_error: interrupted, result: interrupted ? "" : "slow done" });
  } else {
    // a turn that opens with the captain's operating rules: the model answers the message after them, as a real one would
    if (text.startsWith("# Operating rules (set by the captain)") && text.includes("The message follows.\n\n")) text = text.slice(text.indexOf("The message follows.\n\n") + "The message follows.\n\n".length);
    const say = `echo: ${text.split("\n")[0].slice(0, 80)}${files.length ? ` [${files.map((f) => `${f.type} ${f.media_type} ${f.bytes}B`).join(", ")}]` : ""}`;
    for (const part of say.match(/.{1,10}/gs)) { out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: part } } }); await sleep(5); }
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: say }] } });
    out({ type: "result", subtype: "success", is_error: false, result: say });
  }
  touch({ type: "assistant", message: { role: "assistant", content: "done" } });
  if (text.includes("STUB_LATER")) setTimeout(() => { // as an asyncRewake Stop hook does: a turn nobody sent
    out({ type: "system", subtype: "init", session_id: id, model: "stub-opus", tools: [], permissionMode: effectiveMode() });
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "woken by the hook" }] } });
    out({ type: "result", subtype: "success", is_error: false, result: "woken by the hook" });
  }, 300);
}

let chain = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === "control_request" && m.request?.subtype === "interrupt") { interrupted = true; out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } }); return; }
  if (m.type === "user") {
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    const t = content.find((c) => c.type === "text")?.text ?? "";
    // chat attachments: image and document blocks as the CLI takes them; STUB_INPUT_FILE records their shape (never the bytes)
    const files = content.filter((c) => c.type !== "text").map((c) => ({ type: c.type, source: c.source?.type, media_type: c.source?.media_type, bytes: c.source?.data ? Buffer.from(c.source.data, "base64").length : null, title: c.title ?? null }));
    if (process.env.STUB_INPUT_FILE) appendFileSync(process.env.STUB_INPUT_FILE, JSON.stringify({ text: t, files }) + "\n");
    chain = chain.then(() => turn(t, files));
  }
});
