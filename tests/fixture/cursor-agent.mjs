// Strict offline cursor-agent fixture (tests/acceptance.ts with ACCEPTANCE_PROVIDER=cursor, tests/cursor-vendor.ts).
// No real vendor, login, network or config access. It answers only to the acceptance key (CURSOR_API_KEY starting
// crsr_acceptance); anything else is "not logged in", as the real CLI says without a key.
//   --version                   a fixture version (no key needed, as with the real CLI)
//   create-chat                 prints a new chat id
//   -p --output-format stream-json --workspace W … <text>
//     Firstmate (W/.cursor/mcp.json's studio server reaches a native socket): the scripted Firstmate turns of
//     tests/fixture/codex-account.mjs, its tools over that MCP server; otherwise a worker or reviewer round, the shared
//     scripted agent (tests/acceptance/agent.mjs cursorPrint). A Firstmate turn's `--image <path>` files must be images
//     on disk; it answers FIXTURE-SAW-IMAGES with their SHA-256 prefixes.
// Every -p run refuses a cli-config.json that does not deny the built-in Shell, Read and Write tools, except an image
// run (its allow list names GenerateImage(*)), which must deny Shell and Read and allow nothing but GenerateImage(*) (and
// Read(reference.png)); as the real CLI does, a Write(**) deny then refuses saving the image. Its turn lists the image
// tool, saves tests/fixture/jpeg/cursor-image.jpg under $CURSOR_DATA_DIR/projects/<workspace>/assets/ and returns it as
// imageData. The prompt's CURSOR-IMAGE:<mode> picks a failure: refused, duplicate, edit (a successful file edit), denied
// (a denied shell call, then the image), fail (the turn fails), escape (writes its workspace, the private root above it
// and /private/tmp; the turn fails naming any write that succeeded, else makes the image).
//   CURSOR_FIXTURE_LOG  a file each run appends its argv (without the prompt) and chat id to (tests/cursor-vendor.ts)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
if (perms?.allow?.includes("GenerateImage(*)")) { await imageTurn(); process.exit(0); }
if (!["Shell(*)", "Read(**)", "Write(**)"].every((d) => perms?.deny?.includes(d))) fail("cursor-agent fixture: cli-config.json does not deny the built-in tools", 2);
let server = null;
try { server = JSON.parse(readFileSync(join(get("--workspace"), ".cursor", "mcp.json"), "utf8")).mcpServers.studio; } catch {}
if (!server) fail("cursor-agent fixture: no studio MCP server in the workspace's .cursor/mcp.json", 2);
if (!server.env?.CREW_STUDIO_SOCKET) { await cursorPrint(argv); process.exit(process.exitCode ?? 0); }

// ---------- Firstmate (host) turn ----------
const session_id = get("--resume") ?? randomUUID(), model = get("--model") ?? "composer-2.5";
// --image <path> (repeatable): the headless prompt's images, read from disk as cursor-agent does; anything not an image fails the run
const images = argv.flatMap((a, i) => a === "--image" ? [argv[i + 1]] : []).map((p) => {
  let b; try { b = readFileSync(p); } catch { fail(`cursor-agent fixture: --image ${p} cannot be read`, 2); }
  if (!(b[0] === 0x89 && b[1] === 0x50 || b[0] === 0xff && b[1] === 0xd8 || b.subarray(0, 3).toString() === "GIF" || b.subarray(8, 12).toString() === "WEBP")) fail("cursor-agent fixture: --image is not an image", 2);
  return { path: p, sha256: createHash("sha256").update(b).digest("hex") };
});
log({ argv: argv.slice(0, -1), chat: session_id, home: process.env.HOME, images });
const text = argv.at(-1).replace(/(?:\n\n\[Studio note: [^\n]*\])+$/, "");
out({ type: "system", subtype: "init", apiKeySource: "env", cwd: get("--workspace"), session_id, model, permissionMode: "default" });
const say = (t) => out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] }, session_id });
if (images.length) say(`FIXTURE-SAW-IMAGES ${images.map((i) => i.sha256.slice(0, 12)).join(",")}`);
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

// ---------- an image job (src/providers/cursor-image.ts) ----------
async function imageTurn() {
  const ws = get("--workspace"), text = argv.at(-1), mode = /CURSOR-IMAGE:([a-z]+)/.exec(text)?.[1] ?? "success", session_id = randomUUID();
  if (!["Shell(*)", "Read(**)"].every((d) => perms.deny?.includes(d)) || perms.allow.some((a) => a !== "GenerateImage(*)" && a !== "Read(reference.png)")) fail("cursor-agent fixture: an image run must deny Shell and Read and allow only the image tool", 2);
  let servers = null; try { servers = JSON.parse(readFileSync(join(ws, ".cursor", "mcp.json"), "utf8")).mcpServers; } catch {}
  if (!servers || Object.keys(servers).length) fail("cursor-agent fixture: an image run registers no MCP server", 2);
  if (!existsSync(join(ws, "AGENTS.md")) || !readFileSync(join(ws, "AGENTS.md"), "utf8").includes("# Operating rules (set by the captain)")) fail("cursor-agent fixture: the image run's AGENTS.md carries no operating rules", 2);
  if (text.includes("reference.png") && (!perms.allow.includes("Read(reference.png)") || readFileSync(join(ws, "reference.png")).subarray(1, 4).toString() !== "PNG")) fail("cursor-agent fixture: the reference image is not readable", 2);
  out({ type: "system", subtype: "init", apiKeySource: "env", cwd: ws, session_id, model: get("--model") ?? "composer-2.5", permissionMode: "default" });
  if (mode === "fail") fail("the model run failed");
  const call = (n, kind, args, result) => { const id = `fixture-image-${n}`; out({ type: "tool_call", subtype: "started", call_id: id, tool_call: { [kind]: { args } }, session_id }); out({ type: "tool_call", subtype: "completed", call_id: id, tool_call: { [kind]: { args, result } }, session_id }); };
  if (mode === "escape") {
    const wrote = [join(ws, "escape.txt"), join(ws, "..", "escape.txt"), `/private/tmp/crew-cursor-image-escape-${process.pid}`].filter((f) => { try { writeFileSync(f, "escaped"); return true; } catch { return false; } });
    if (wrote.length) fail(`ESCAPED: ${wrote.join(", ")}`);
  }
  call(1, "getMcpToolsToolCall", { server: "cursor", toolName: "GenerateImage" }, { success: { tools: [{ name: "GenerateImage" }] } });
  if (mode === "denied") call(2, "shellToolCall", { command: "ls" }, { permissionDenied: { error: "Command blocked by permissions configuration" } });
  if (mode === "edit") call(2, "editToolCall", { path: join(ws, "x.txt") }, { success: { path: join(ws, "x.txt") } });
  const args = { description: text.slice(0, 200), referenceImagePaths: text.includes("reference.png") ? ["reference.png"] : [], aspectRatio: "1:1" };
  if (mode === "refused") call(3, "generateImageToolCall", args, { rejected: { reason: "Image generation is not allowed" } });
  else {
    const jpeg = readFileSync(join(import.meta.dir, "jpeg", "cursor-image.jpg")), assets = join(process.env.CURSOR_DATA_DIR ?? "/nonexistent", "projects", basename(ws), "assets"), filePath = join(assets, "image.jpg");
    let saved = !perms.deny.includes("Write(**)");
    if (saved) try { mkdirSync(assets, { recursive: true }); writeFileSync(filePath, jpeg); } catch { saved = false; }
    const result = saved ? { success: { filePath, imageData: jpeg.toString("base64") } } : { error: { error: "Failed to save generated image: permission denied (Blocked by permissions configuration)" } };
    call(3, "generateImageToolCall", args, result);
    if (mode === "duplicate") call(4, "generateImageToolCall", args, result);
  }
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "The image is ready." }] }, session_id });
  out({ type: "result", subtype: "success", is_error: false, result: "The image is ready.", session_id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
}
