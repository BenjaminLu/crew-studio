// A stand-in for `cursor-agent -p --output-format stream-json` in tests: no model is called. Like cursor-agent it reads
// its MCP servers from the workspace's .cursor/mcp.json and its permissions from $XDG_CONFIG_HOME/cursor/cli-config.json
// (else $HOME/.cursor/), calls
// Studio's tool endpoint for real with the server's own env, rejects a tool the allow list does not name, and prints
// cursor-agent's stream-json shapes. Same behaviours as the claude and codex stubs: STUB_TIMEOUT, STUB_LOGIN,
// STUB_INTENT, STUB_MANY, otherwise a cited status answer about the first merged task.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const argv = process.argv.slice(2);
const prompt = argv.at(-1) ?? "";
const msg = /Captain's new message: ([^\n]*)/.exec(prompt)?.[1] ?? prompt;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = argv[argv.indexOf("--workspace") + 1];
const fail = (why) => { out({ type: "result", subtype: "error", is_error: true, result: why }); process.exit(1); };
if (!ws || !existsSync(join(ws, ".cursor", "mcp.json"))) fail("stub: no workspace .cursor/mcp.json");
if (!existsSync(join(ws, "AGENTS.md"))) fail("stub: no AGENTS.md carrying the system prompt");
const server = JSON.parse(readFileSync(join(ws, ".cursor", "mcp.json"), "utf8")).mcpServers?.studio;
const cfg = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "cursor", "cli-config.json") : join(process.env.HOME, ".cursor", "cli-config.json");
const perms = existsSync(cfg) ? JSON.parse(readFileSync(cfg, "utf8")).permissions ?? {} : {};
if (!["Shell(*)", "Read(**)", "Write(**)"].every((d) => perms.deny?.includes(d))) fail("stub: built-in tools are not all denied");
const URL_ = server?.env?.CREW_STUDIO_URL, TOKEN = readFileSync(server?.env?.CREW_TOOL_TOKEN_FILE, "utf8").trim();
let n = 0;
const tool = async (name, args) => {
  const call_id = `tool_stub_${++n}`, mcpToolCall = { args: { name: `studio-${name}`, args, toolName: name, providerIdentifier: "studio" } };
  out({ type: "tool_call", subtype: "started", call_id, tool_call: { mcpToolCall } });
  if (!perms.allow?.includes(`Mcp(studio:${name})`)) {
    out({ type: "tool_call", subtype: "completed", call_id, tool_call: { mcpToolCall: { ...mcpToolCall, result: { rejected: { reason: `User rejected MCP: studio-${name}` } } } } });
    return null;
  }
  const r = await fetch(`${URL_}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": TOKEN }, body: JSON.stringify(args) });
  const text = await r.text();
  out({ type: "tool_call", subtype: "completed", call_id, tool_call: { mcpToolCall: { ...mcpToolCall, result: { success: { content: [{ text: { text } }], isError: !r.ok } } } } });
  return JSON.parse(text);
};
const say = (text) => out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const done = (result) => out({ type: "result", subtype: "success", is_error: false, result, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });

out({ type: "system", subtype: "init", apiKeySource: "env", model: "stub" });
if (msg.includes("STUB_TIMEOUT")) { await sleep(60_000); process.exit(0); }
if (msg.includes("STUB_LOGIN")) { process.stderr.write("Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n"); process.exit(1); }
if (msg.includes("STUB_MANY")) { for (let i = 0; i < 10; i++) { await tool("runs_list", {}); await sleep(50); } say("done"); done("done"); process.exit(0); }
if (msg.includes("STUB_INTENT")) {
  const i = await tool("intent_capture", { goal: "Add a dark mode to the docs site", details: "from the stub" });
  const text = `Recorded as intent [${i.id}](#/intents/${i.id}). firstmate will draft a spec and raise a dispatch card.`;
  say(text); done(text); process.exit(0);
}
const runs = await tool("runs_list", {});
const t = runs.find((x) => x.status === "done") ?? runs[0];
const d = await tool("task_get", { id: t.id });
const ev = d.merged?.link ?? d.lastEvents?.[0]?.link ?? `#/task/${t.id}`;
const text = `[${t.id}](#/task/${t.id}) is ${t.status}. Last step: [event](${ev}).`;
say(text); done(text);
