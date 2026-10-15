// A stand-in for `codex exec --json` in tests: no model is called. It calls
// Studio's tool endpoint with the question's token, as Codex's MCP client
// would, and prints codex's JSON event shapes. Same behaviours as the claude
// stub: STUB_TIMEOUT, STUB_LOGIN, STUB_INTENT, STUB_MANY, otherwise a status answer.
const argv = process.argv.slice(2);
const prompt = argv.at(-1) ?? "";
const msg = /Captain's new message: ([^\n]*)/.exec(prompt)?.[1] ?? prompt;
const URL_ = process.env.CREW_STUDIO_URL, TOKEN = process.env.CREW_TOOL_TOKEN;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const tool = async (name, args) => {
  const id = `item_${n++}`;
  out({ type: "item.started", item: { id, type: "mcp_tool_call", server: "studio", tool: name, arguments: args, result: null, error: null, status: "in_progress" } });
  const r = await fetch(`${URL_}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": TOKEN }, body: JSON.stringify(args) });
  const text = await r.text();
  out({ type: "item.completed", item: { id, type: "mcp_tool_call", server: "studio", tool: name, arguments: args, status: r.ok ? "completed" : "failed",
    result: r.ok ? { content: [{ type: "text", text }], structured_content: null } : null, error: r.ok ? null : { message: text.slice(0, 200) } } });
  return JSON.parse(text);
};
const say = (text) => out({ type: "item.completed", item: { id: `item_${n++}`, type: "agent_message", text } });

out({ type: "thread.started", thread_id: "stub-thread" });
out({ type: "turn.started" });
if (msg.includes("STUB_TIMEOUT")) { await sleep(60_000); process.exit(0); }
if (msg.includes("STUB_LOGIN")) { out({ type: "turn.failed", error: { message: "Not logged in. Run `codex login`." } }); process.exit(1); }
if (msg.includes("STUB_MANY")) { for (let i = 0; i < 10; i++) { await tool("runs_list", {}); await sleep(50); } say("done"); }
else if (msg.includes("STUB_INTENT")) {
  const i = await tool("intent_capture", { goal: "Add a dark mode to the docs site", details: "from the stub" });
  say(`Recorded as intent [${i.id}](#/intents/${i.id}). firstmate will draft a spec and raise a dispatch card.`);
} else {
  const runs = await tool("runs_list", {});
  const t = runs.find((x) => x.status === "done") ?? runs[0];
  const d = await tool("task_get", { id: t.id });
  const ev = d.merged?.link ?? d.lastEvents?.[0]?.link ?? `#/task/${t.id}`;
  say(`[${t.id}](#/task/${t.id}) is ${t.status}. Last step: [event](${ev}).`);
}
out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
