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
import { connect as tcp } from "node:net";
import { openSync, readFileSync, closeSync, writeFileSync, rmSync } from "node:fs";
import { join as joinPath } from "node:path";

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
  const onboarding=/^Call onboarding_read with nonce ([a-f0-9]+)\./.exec(text);
  if(onboarding){const result=yield* call('onboarding_read',{nonce:onboarding[1]});if(typeof result?.challenge!=='string')throw new Error('No onboarding challenge');yield* say(result.challenge);return true;}
  if (text.startsWith("DELIVER ")) {
    const kind = /^DELIVER (\w+)/.exec(text)[1], intent = (/^Intent: (.*)$/m.exec(text)?.[1] ?? "Acceptance").slice(0, 80);
    const variant = /^Variant: (.*)$/m.exec(text)?.[1] ?? "A";
    if (kind === "document") yield* call("work_write", { path: "doc.md", content: `# ${intent}\n\nThis acceptance draft answers the captain's intent in a few plain sentences.\n\n## Details\n\n- One point.\n- Another point.\n` });
    else if (kind === "video") {
      const files = (yield* call("work_list", {})) ?? []; if (!files.some?.((f) => f.path === "film.html")) throw new Error("the film template is missing"); yield* call("work_read", { path: "film.html", start: 1, lines: 20 });
      // like an editor: the fades the captain named, on the whole stage (a real render's first and last frames are then dark)
      if (/fade/i.test(text)) { const r = yield* call("work_replace", { path: "film.html", old: "function render(t){renderAt(t-OFF)}", new: "function render(t){renderAt(t-OFF);document.getElementById('stage').style.opacity=Math.max(0,Math.min(1,t/0.8,(DUR-t)/0.8))}" }); if (r?.error) throw new Error(`work_replace refused: ${r.error}`); }
    }
    else {
      // a button the captain named ("Add task" button) works: an inline handler (the preview CSP allows inline script) adds a row
      const button = /["“]([^"”\n]{2,30})["”]\s+button/.exec(text)?.[1];
      const control = button ? `<button id="act" type="button">${button}</button><ul id="rows"><li>First task</li></ul><script>document.getElementById("act").addEventListener("click",()=>{const li=document.createElement("li");li.textContent="New task "+(document.querySelectorAll("#rows li").length+1);document.getElementById("rows").appendChild(li);});</script>` : "";
      yield* call("work_write", { path: "index.html", content: `<!doctype html><html><head><meta charset="utf-8"><title>${intent}</title></head><body><main><h1>${intent}</h1><p>Variant ${variant}</p>${control}</main></body></html>` });
    }
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
  // the coordinator fills the repository's pull request template: one plain text per section it is asked for, no ticks
  if (text.startsWith("PULL REQUEST TEXT")) {
    const list = /^SECTIONS TO WRITE[^\n]*\n([\s\S]*?)\n\n/m.exec(text)?.[1] ?? "";
    const headings = [...list.matchAll(/^- (.+?)(?: — guidance: .*)?$/gm)].map((m) => m[1].trim());
    const title = (/^Spec: (.+)$/m.exec(text)?.[1] ?? /^#+ (.+)$/m.exec(text.split("TEST TABLE ROWS")[1] ?? "")?.[1] ?? "The requested change").slice(0, 72).replace(/\.$/, "");
    const r = yield* call("pull_request_text", { title, sections: headings.map((heading) => ({ heading, text: `${heading}: written from the spec and Studio's evidence for this head.` })), ticks: [] });
    if (r?.error) throw new Error(`pull_request_text refused: ${r.error}`);
    yield* say("Pull request text written."); return true;
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

// ---------- the sandbox probe (ACCEPT_PROBE in the captain's intent) ----------
// What a real vendor CLI could do from inside its round, tried from the same process (the stub CLI runs under the round's
// sandbox-exec profile, env and proxy credential): the network only through the egress proxy and only to its provider's
// API hosts, its own login readable, the source logins and Studio's data not. No request is ever sent to a provider: an
// allowed CONNECT is closed as soon as the proxy answers (or after a short wait), before any byte of TLS.
// The intent carries what to try: ACCEPT_PROBE host=<api host> sink=<loopback port> studio=<Studio's port> deny=<path>,<path> nowrite=<path>,<path>
// The result is one line the harness reads from the round record: ACCEPT_PROBE_RESULT {json}
const tryTcp = (host, port, ms = 1500) => new Promise((resolve) => {
  const s = tcp({ host, port }); const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
  const t = setTimeout(() => done({ ok: false, error: "timeout" }), ms);
  s.once("connect", () => done({ ok: true })); s.once("error", (e) => done({ ok: false, error: e.code ?? String(e.message ?? e) }));
});
/** One CONNECT through the admitted round's scoped relay; central authentication stays inside Studio. */
const viaProxy = (target, auth = true, ms = 4000) => new Promise((resolve) => {
  let u; try { u = new URL(process.env.HTTPS_PROXY ?? ""); } catch { return resolve({ status: null, error: "no HTTPS_PROXY in the round's env" }); }
  const s = tcp({ host: u.hostname, port: Number(u.port) }); let buf = "";
  const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
  const t = setTimeout(() => done({ status: null, error: "no answer (the proxy is still connecting upstream: allowed)" }), ms);
  s.once("connect", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}\r\n` : ""}\r\n`));
  s.on("data", (d) => { buf += d.toString("latin1"); const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf); if (m) done({ status: Number(m[1]) }); });
  s.once("error", (e) => done({ status: null, error: e.code ?? String(e.message ?? e) }));
});
// open() is where the sandbox checks a read: nothing of the file itself is read
const readable = (p) => { try { closeSync(openSync(p, "r")); return true; } catch { return false; } };
const writable = (dir) => { const f = joinPath(dir, `.acceptance-probe-${process.pid}`); try { writeFileSync(f, "x"); rmSync(f, { force: true }); return true; } catch { return false; } };
async function sandboxProbe(prompt) {
  const arg = (k) => (new RegExp(`ACCEPT_PROBE[^\\n]*\\b${k}=(\\S+)`).exec(prompt)?.[1] ?? "");
  const list = (k) => arg(k).split(",").filter(Boolean);
  const host = arg("host"), sink = Number(arg("sink")), proxy = (() => { try { return new URL(process.env.HTTPS_PROXY); } catch { return null; } })();
  const tool = (() => { try { return new URL(process.env.CREW_STUDIO_URL); } catch { return null; } })();
  const r = {
    proxyEnv: !!proxy && proxy.protocol === "http:" && proxy.hostname === "127.0.0.1" && Number(proxy.port) >= 43000 && Number(proxy.port) <= 43063,
    proxyCredentialFree: !!proxy && !proxy.username && !proxy.password,
    noProxyLoopbackOnly: (process.env.NO_PROXY ?? "") === "localhost,127.0.0.1,::1",
    // straight out, around the proxy: an IP (no DNS needed) and the sink the harness listens on
    directPublic: await tryTcp("1.1.1.1", 443),
    directSink: sink ? await tryTcp("127.0.0.1", sink) : { ok: false, error: "no sink" },
    directStudio: Number(arg("studio")) ? await tryTcp("127.0.0.1", Number(arg("studio"))) : { ok: false, error: "no studio port" },
    toolListener: tool ? await tryTcp(tool.hostname, Number(tool.port)) : { ok: false, error: "no CREW_STUDIO_URL" },
    providerViaProxy: host ? await viaProxy(`${host}:443`) : { status: null, error: "no host" },
    otherViaProxy: await viaProxy("example.com:443"),
    noCredentialViaProxy: await viaProxy(`${host || "example.com"}:443`, false),
    // its own login (what Studio handed the round), and nothing else
    ownLogin: process.env.CLAUDE_CODE_OAUTH_TOKEN ? "env:CLAUDE_CODE_OAUTH_TOKEN" : readable(joinPath(process.env.HOME ?? "/nonexistent", ".codex", "auth.json")) ? "file:$HOME/.codex/auth.json" : null,
    ownLoginRefresh: (() => { try { return JSON.parse(readFileSync(joinPath(process.env.HOME, ".codex", "auth.json"), "utf8")).tokens?.refresh_token ?? null; } catch { return null; } })(),
    otherCredentials: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN"].filter((k) => process.env[k]),
    denied: Object.fromEntries(list("deny").map((p) => [p, readable(p)])),
    tmpWritable: writable(process.env.TMPDIR ?? "/nonexistent"),
    nowrite: Object.fromEntries(list("nowrite").map((p) => [p, writable(p)])),
  };
  return r;
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
    // first, before any tool call: what this sandboxed process can reach (read back from the round record by the harness)
    if (/ACCEPT_PROBE\b/.test(prompt)) emit({ text: `ACCEPT_PROBE_RESULT ${JSON.stringify(await sandboxProbe(prompt))}\n` });
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
