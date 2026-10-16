// The scripted agent behind the acceptance harness's stub CLIs (tests/fixture/codex-account.mjs
// `codex exec`, tests/fixture/claude-native.mjs `claude -p`). No model is called. It is reached only
// through a real CLI invocation that Studio's Agents.execute started: the real sandbox profile,
// round env, login copy and egress apply to it. It talks to Studio the way the vendor CLI does:
// it starts the MCP server named on its command line (src/mcp.ts), lists the tools the round was
// given, calls them over MCP, and prints the vendor's own event shapes on stdout.
//
// What it does is decided by the round's prompt: the scripted modes below, else the shared offline
// scripts in src/providers/stub-agent.ts (NATIVE PACK …, SPEC DRAFT …, BUILD ROUND …). Markers in the
// captain's intent steer a path (ACCEPT_ASK: a code worker asks the captain a question; ACCEPT_REVISE:
// the startup judge asks for revisions). Anything it cannot script ends the turn with an error
// that names the prompt, so a new mode fails loudly instead of passing silently.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** One stdio MCP session with the server the CLI was told to start. */
function mcpSession(server) {
  const p = spawn(server.command, server.args ?? [], { env: { ...process.env, ...(server.env ?? {}) }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map(); let n = 0;
  createInterface({ input: p.stdout }).on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; } const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  return { rpc, close: () => { try { p.kill(); } catch {} } };
}
const textOf = (content) => (Array.isArray(content) ? content.map((c) => c?.text ?? "").join("") : String(content ?? ""));

// ---------- scripted modes the shared stub agent does not cover ----------
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function* acceptanceScript(text, call, say) {
  if (text.startsWith("DELIVER ")) {
    const kind = /^DELIVER (\w+)/.exec(text)[1], intent = (/^Intent: (.*)$/m.exec(text)?.[1] ?? "Acceptance").slice(0, 80);
    const variant = /^Variant: (.*)$/m.exec(text)?.[1] ?? "A";
    if (kind === "document") yield* call("work_write", { path: "doc.md", content: `# ${intent}\n\nThis acceptance draft answers the captain's intent in a few plain sentences.\n\n## Details\n\n- One point.\n- Another point.\n` });
    else if (kind === "video") { const files = (yield* call("work_list", {})) ?? []; if (!files.some?.((f) => f.path === "film.html")) throw new Error("the film template is missing"); yield* call("work_read", { path: "film.html", start: 1, lines: 20 }); }
    else yield* call("work_write", { path: "index.html", content: `<!doctype html><html><head><meta charset="utf-8"><title>${intent}</title></head><body><main><h1>${intent}</h1><p>Variant ${variant}</p></main></body></html>` });
    yield* say(`Delivered ${kind} variant ${variant}.`); return true;
  }
  if (text.startsWith("STARTUP COMPETITION")) {
    const role = /^Role: (\w+); round: (\d)/m.exec(text), judge = role?.[1] === "judge", round = Number(role?.[2] ?? 1);
    const revise = /ACCEPT_REVISE/.test(text) && round < 2;
    const r = yield* call("startup_submit", judge
      ? { text: `Critique round ${round}: willingness to pay is untested; run five paid pilots before any growth spending.`, score: 60 + round, verdict: revise ? "revise" : "ready" }
      : { text: `Proposal round ${round}: a customer research service for independent coffee shops, validated with paid pilots and explicit revenue assumptions.`, revision: round > 1 ? `Addressed critique ${round - 1}: validation is now five paid pilots.` : "" });
    if (r?.error) throw new Error(`startup_submit refused: ${r.error}`);
    yield* say(judge ? "Critique submitted." : "Proposal submitted."); return true;
  }
  if (text.startsWith("Create the useful coffee-shop introduction page.")) {
    const name = /"name":"([^"]{1,80})"/.exec(text)?.[1] ?? "Coffee";
    yield* call("work_write", { path: "index.html", content: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>body{margin:0;font:18px Georgia,serif;background:#f5efe3;color:#35261f}main{max-width:960px;margin:auto;padding:24px}.hero{aspect-ratio:16/9;width:100%}img,video{width:100%;height:auto}</style></head><body><main><h1>${name}</h1><video class="hero" controls src="assets/coffee.mp4"></video><img src="assets/coffee.png" alt="A cup of coffee and a croissant"><section id="story"><h2>A little pause</h2><p>Coffee, warm light and room to breathe.</p></section><a href="#story">Our story</a></main></body></html>` });
    yield* say("Wrote index.html."); return true;
  }
  // a code worker with a question for the captain (ACCEPT_ASK), until the captain's answer (ACCEPT_ANSWERED) reaches its prompt
  if (text.startsWith("BUILD ROUND") && /ACCEPT_ASK/.test(text) && !/ACCEPT_ANSWERED/.test(text)) {
    yield* call("fs_list", {});
    const r = yield* call("worker_report", { marker: "ASK", summary: "Question for the captain: should the discount be 10% or 15%? I have not changed any file." });
    if (r?.error) throw new Error(`worker_report refused: ${r.error}`);
    yield* say("ASK: should the discount be 10% or 15%?"); return true;
  }
  return false;
}

/**
 * Run one agent turn. `emit` receives vendor-neutral events; the vendor wrappers print them in
 * their CLI's own format: {tool:{id,name,args}}, {toolResult:{id,text,error}}, {text}.
 */
export async function runTurn({ prompt, server, emit }) {
  const mcp = mcpSession(server);
  try {
    await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "acceptance-cli", version: "1" } });
    const listed = await mcp.rpc("tools/list", {});
    const names = new Set((listed.result?.tools ?? []).map((t) => t.name));
    let k = 0;
    const call = async function* (name, args) {
      const id = `acc_${++k}`;
      if (!names.has(name)) throw new Error(`the round has no tool ${name} (it has: ${[...names].join(", ")})`);
      emit({ tool: { id, name, args } });
      const r = await mcp.rpc("tools/call", { name, arguments: args });
      const body = textOf(r.result?.content ?? r.error?.message);
      emit({ toolResult: { id, name, args, text: body, error: !!r.result?.isError || !!r.error } });
      try { return JSON.parse(body); } catch { return null; }
    };
    const say = async function* (s) { emit({ text: s }); return true; };
    const script = async () => {
      const own = acceptanceScript(prompt, call, say);
      let r; while (!(r = await own.next()).done) {}
      if (r.value) return;
      const { stubAgent } = await import("../../src/providers/stub-agent.ts");
      let said = false;
      const sayOnce = async function* (s) { said = true; emit({ text: s }); return true; };
      for await (const e of stubAgent(prompt, call, sayOnce)) if (e === "interrupted") throw new Error("interrupted");
      if (!said) throw new Error(`no acceptance script for this prompt: ${prompt.split("\n")[0].slice(0, 120)}`);
    };
    await script();
  } finally { mcp.close(); }
}

// ---------- vendor CLI shapes ----------
const jsonValue = (raw) => JSON.parse(raw); // a TOML basic string or array of them is JSON
/** `codex exec --json … -c mcp_servers.studio.*=… <prompt>`: codex's exec JSON events. */
export async function codexExec(argv) {
  const cfg = {}; for (let i = 0; i < argv.length - 1; i++) if (argv[i] === "-c") { const s = argv[i + 1], eq = s.indexOf("="); cfg[s.slice(0, eq)] = s.slice(eq + 1); }
  const env = Object.fromEntries([...(cfg["mcp_servers.studio.env"] ?? "").matchAll(/(\w+)=("(?:[^"\\]|\\.)*")/g)].map((m) => [m[1], jsonValue(m[2])]));
  const server = { command: jsonValue(cfg["mcp_servers.studio.command"]), args: jsonValue(cfg["mcp_servers.studio.args"] ?? "[]"), env };
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "thread.started", thread_id: "acceptance-thread" }); out({ type: "turn.started" });
  try {
    await runTurn({ prompt: argv.at(-1), server, emit: (e) => {
      if (e.tool) out({ type: "item.started", item: { id: e.tool.id, type: "mcp_tool_call", server: "studio", tool: e.tool.name, arguments: e.tool.args, result: null, error: null, status: "in_progress" } });
      else if (e.toolResult) out({ type: "item.completed", item: { id: e.toolResult.id, type: "mcp_tool_call", server: "studio", tool: e.toolResult.name, arguments: e.toolResult.args, status: e.toolResult.error ? "failed" : "completed", result: { content: [{ type: "text", text: e.toolResult.text }], structured_content: null }, error: null } });
      else if (e.text) out({ type: "item.completed", item: { id: `msg_${Date.now()}`, type: "agent_message", text: e.text } });
    } });
    out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
  } catch (err) { out({ type: "turn.failed", error: { message: `acceptance agent: ${err?.message ?? err}` } }); process.exitCode = 1; }
}
/** `claude -p <prompt> --output-format stream-json --model M --mcp-config <json> …`: claude's stream-json. */
export async function claudePrint(args) {
  const get = (k) => args[args.indexOf(k) + 1], model = get("--model");
  const server = JSON.parse(get("--mcp-config")).mcpServers.studio;
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "system", subtype: "init", model, tools: [] });
  let said = "";
  try {
    await runTurn({ prompt: get("-p"), server, emit: (e) => {
      if (e.tool) out({ type: "assistant", message: { model, role: "assistant", content: [{ type: "tool_use", id: e.tool.id, name: `mcp__studio__${e.tool.name}`, input: e.tool.args }] } });
      else if (e.toolResult) out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: e.toolResult.id, content: [{ type: "text", text: e.toolResult.text }], is_error: e.toolResult.error }] } });
      else if (e.text) { said += e.text; out({ type: "assistant", message: { model, role: "assistant", content: [{ type: "text", text: e.text }] } }); }
    } });
    out({ type: "result", subtype: "success", is_error: false, result: said || "done", modelUsage: { [model]: { inputTokens: 1, outputTokens: 1 } }, usage: { input_tokens: 1, output_tokens: 1 } });
  } catch (err) { out({ type: "result", subtype: "error_during_execution", is_error: true, result: `acceptance agent: ${err?.message ?? err}`, modelUsage: { [model]: { inputTokens: 1, outputTokens: 1 } } }); process.exitCode = 1; }
}
