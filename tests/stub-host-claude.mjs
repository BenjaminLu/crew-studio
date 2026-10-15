// A stand-in for a long-lived `claude -p --resume <id> --input-format stream-json
// --output-format stream-json` in tests: no model is called. It reads captain
// turns from stdin, writes the session file under $HOME/.claude/projects like
// claude does, and prints claude's stream-json shapes. The message picks the
// behaviour: STUB_TOOL (asks permission through the real permission MCP server
// from --mcp-config), STUB_SLOW (streams until interrupted), otherwise an echo.
// A session id starting with "fork-" is re-identified as "<id>-new" on init.
import { appendFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const want = argv[argv.indexOf("--resume") + 1];
if (argv.includes("--dangerously-skip-permissions") || argv.includes("bypassPermissions")) { console.error("stub: refuses bypass"); process.exit(9); }
const id = argv.includes("--fork-session") ? `${want}-copy` : want.startsWith("fork-") ? `${want}-new` : want;
if (process.env.STUB_ARGV_FILE) appendFileSync(process.env.STUB_ARGV_FILE, JSON.stringify({ argv, FM_IN_ROUND: process.env.FM_IN_ROUND ?? null }) + "\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = join(homedir(), ".claude/projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const touch = (o) => appendFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ ...o, sessionId: id, cwd: process.cwd(), isSidechain: false }) + "\n");
const mcpCfg = argv.includes("--mcp-config") ? JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) : null;
let inited = false, interrupted = false, slow = false;

async function askPermission(name, input) {
  const s = Object.values(mcpCfg?.mcpServers ?? {})[0];
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

async function turn(text) {
  if (!inited) { inited = true; out({ type: "system", subtype: "init", session_id: id, model: "stub-opus", tools: [] }); }
  touch({ type: "user", message: { role: "user", content: text } });
  if (text.includes("STUB_TOOL")) {
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
    const say = `echo: ${text.split("\n")[0].slice(0, 80)}`;
    for (const part of say.match(/.{1,10}/gs)) { out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: part } } }); await sleep(5); }
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: say }] } });
    out({ type: "result", subtype: "success", is_error: false, result: say });
  }
  touch({ type: "assistant", message: { role: "assistant", content: "done" } });
  if (text.includes("STUB_LATER")) setTimeout(() => { // as an asyncRewake Stop hook does: a turn nobody sent
    out({ type: "system", subtype: "init", session_id: id, model: "stub-opus", tools: [] });
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "woken by the hook" }] } });
    out({ type: "result", subtype: "success", is_error: false, result: "woken by the hook" });
  }, 300);
}

let chain = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === "control_request" && m.request?.subtype === "interrupt") { interrupted = true; out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } }); return; }
  if (m.type === "user") { const t = m.message?.content?.find?.((c) => c.type === "text")?.text ?? ""; chain = chain.then(() => turn(t)); }
});
