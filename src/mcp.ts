// A stdio MCP server that exposes Crew Studio's chat tools to the claude CLI.
// It holds no data: every call goes to the Studio server that spawned the CLI,
// with a per-question token, so only that question's tools run.
//   CREW_STUDIO_URL   e.g. http://127.0.0.1:4210
//   CREW_TOOL_TOKEN   token the Studio server issued for this question
//   CREW_STUDIO_SOCKET  instead of the URL: a private unix socket a Studio-owned session listens on
//                       (a fresh Claude Firstmate's native tools), same token header
import { mcpContent } from "./tool-content";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const URL_ = process.env.CREW_STUDIO_URL ?? "http://127.0.0.1:4210";
// a Studio-owned session hands the token as a 0600 file (CREW_TOOL_TOKEN_FILE), so it is never on a command line
const TOKEN = process.env.CREW_TOOL_TOKEN_FILE ? (() => { try { return readFileSync(process.env.CREW_TOOL_TOKEN_FILE!, "utf8").trim(); } catch { return ""; } })() : process.env.CREW_TOOL_TOKEN ?? "";
const SOCKET = process.env.CREW_STUDIO_SOCKET ?? "";
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
const call = async (path: string, body?: unknown) => {
  const r = await fetch((SOCKET ? "http://localhost" : URL_) + path, { ...(SOCKET ? { unix: SOCKET } : {}), method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-tool-token": TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(text.slice(0, 500) || `HTTP ${r.status}`);
  return JSON.parse(text);
};

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  const reply = (result: unknown) => { if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, result }); };
  const fail = (code: number, message: string) => { if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code, message } }); };
  try {
    switch (m.method) {
      case "initialize":
        return reply({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "studio", version: "0.2.0" } });
      case "notifications/initialized": return;
      case "ping": return reply({});
      case "tools/list": return reply({ tools: await call("/api/tools") });
      case "tools/call": {
        const r = await call(`/api/tools/${encodeURIComponent(m.params?.name ?? "")}`, m.params?.arguments ?? {});
        return reply({ content: mcpContent(r), isError: !!r?.error }); // a picture (a reviewer's image read) goes as an image block
      }
      default: return fail(-32601, `unknown method ${m.method}`);
    }
  } catch (e: any) {
    if (m.method === "tools/call") return reply({ content: [{ type: "text", text: JSON.stringify({ error: String(e?.message ?? e) }) }], isError: true });
    fail(-32603, String(e?.message ?? e));
  }
});
