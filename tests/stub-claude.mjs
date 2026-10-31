// A stand-in for `claude -p --output-format stream-json` in tests: no model is
// called. It really calls Studio's tool endpoint with the question's token, as
// the MCP server would, and prints claude's stream-json shapes. The captain's
// message picks the behaviour: STUB_TIMEOUT, STUB_LOGIN, STUB_INTENT, STUB_MANY,
// otherwise a cited status answer about the first merged task.
const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf("-p") + 1] ?? "";
const msg = /Captain's new message: ([^\n]*)/.exec(prompt)?.[1] ?? prompt;
const URL_ = process.env.CREW_STUDIO_URL, TOKEN = process.env.CREW_TOOL_TOKEN_FILE ? (await import("node:fs")).readFileSync(process.env.CREW_TOOL_TOKEN_FILE, "utf8").trim() : process.env.CREW_TOOL_TOKEN;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// like the CLI, it first says what the model may use: Studio's tools only (src/providers/claude.ts refuses a round without this)
out({ type: "system", subtype: "init", model: argv[argv.indexOf("--model") + 1] ?? "stub-model", tools: (argv[argv.indexOf("--allowedTools") + 1] ?? "").split(",").filter(Boolean), mcp_servers: [{ name: "studio", status: "connected" }] });
let n = 0;
const tool = async (name, input) => {
  const id = `toolu_stub_${++n}`;
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: `mcp__studio__${name}`, input }] } });
  const r = await fetch(`${URL_}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": TOKEN }, body: JSON.stringify(input) });
  const text = await r.text();
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], is_error: !r.ok }] } });
  return JSON.parse(text);
};
const say = async (text) => {
  out({ type: "stream_event", event: { type: "message_start" } });
  for (const part of text.match(/.{1,24}/gs) ?? []) { out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: part } } }); await sleep(15); }
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
};

out({ type: "system", subtype: "init", model: "stub", tools: [] });
if (msg.includes("STUB_TIMEOUT")) { await sleep(60_000); process.exit(0); }
if (msg.includes("STUB_LOGIN")) { out({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login" }); process.exit(1); }
if (msg.includes("STUB_MANY")) { for (let i = 0; i < 10; i++) { await tool("runs_list", {}); await sleep(50); } await say("done"); out({ type: "result", subtype: "success", is_error: false, result: "done" }); process.exit(0); }
if (msg.includes("STUB_INTENT")) {
  const i = await tool("intent_capture", { goal: "Add a dark mode to the docs site", details: "from the stub", deadline: "Friday" });
  await say(`Recorded as intent [${i.id}](#/intents/${i.id}). firstmate will draft a spec and raise a dispatch card.`);
  out({ type: "result", subtype: "success", is_error: false, result: "" });
  process.exit(0);
}
const runs = await tool("runs_list", {});
const t = runs.find((x) => x.status === "done") ?? runs[0];
const d = await tool("task_get", { id: t.id });
const ev = d.merged?.link ?? d.lastEvents?.[0]?.link ?? `#/task/${t.id}`;
await say(`[${t.id}](#/task/${t.id}) is ${t.status}. Last step: [event](${ev}). Not linked: [elsewhere](https://example.com/x).`);
out({ type: "result", subtype: "success", is_error: false, result: "" });
