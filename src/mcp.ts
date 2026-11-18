// A stdio MCP server that exposes Crew Studio's chat tools to the claude CLI.
// It holds no data: every call goes to the Studio server that spawned the CLI,
// with a per-question token, so only that question's tools run.
//   CREW_STUDIO_URL   e.g. http://127.0.0.1:4210
//   CREW_TOOL_TOKEN   token the Studio server issued for this question
//   CREW_STUDIO_SOCKET  instead of the URL: a private unix socket a Studio-owned session listens on
//                       (a fresh Claude Firstmate's native tools), same token header
//   --grant-file <path>  an external CLI grant the captain issued on the board (docs/units/cli-mcp-grant.md): the token is
//                        read from that 0600 file, never from the command line; --url <studio> when Studio is not on 4210
//   `claude mcp add studio -- crew-studio mcp --grant-file <path>` (from source: bun src/mcp.ts --grant-file <path>)
import { mcpContent } from "./tool-content";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { SERVER_INSTRUCTIONS } from "./observe/instructions";

/** MCP protocol versions this proxy implements, oldest first. A client asking for one of them gets it back; any other
 *  (an older one, or a newer one such as 2026-07-28) gets the newest here, as the spec's version negotiation says. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25"] as const;
const negotiate = (asked: unknown) => SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === asked) ?? SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
// one fixed order whatever order Studio answers in, so a client's prompt cache sees the same tool list every time
const byName = (tools: any) => Array.isArray(tools) ? [...tools].sort((a, b) => { const x = String(a?.name ?? ""), y = String(b?.name ?? ""); return x < y ? -1 : x > y ? 1 : 0; }) : tools;

const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] ?? "" : null; };
const GRANT_FILE = flag("--grant-file");
if (GRANT_FILE === "") { process.stderr.write("crew-studio mcp: --grant-file needs a path\n"); process.exit(2); }
const URL_ = flag("--url") || process.env.CREW_STUDIO_URL || "http://127.0.0.1:4210";
const readToken = (f: string) => { try { return readFileSync(f, "utf8").trim(); } catch { return ""; } };
// a Studio-owned session hands the token as a 0600 file (CREW_TOOL_TOKEN_FILE), so it is never on a command line; so does a grant
const TOKEN = GRANT_FILE ? readToken(GRANT_FILE) : process.env.CREW_TOOL_TOKEN_FILE ? readToken(process.env.CREW_TOOL_TOKEN_FILE) : process.env.CREW_TOOL_TOKEN ?? "";
if (GRANT_FILE && !TOKEN) { process.stderr.write(`crew-studio mcp: cannot read the grant file ${GRANT_FILE} (revoked, or never issued)\n`); process.exit(2); }
const SOCKET = process.env.CREW_STUDIO_SOCKET ?? "";
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
const call = async (path: string, body?: unknown) => {
  const r = await fetch((SOCKET ? "http://localhost" : URL_) + path, { ...(SOCKET ? { unix: SOCKET } : {}), method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-tool-token": TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(GRANT_FILE ? `HTTP ${r.status} ${text.slice(0, 500)}` : text.slice(0, 500) || `HTTP ${r.status}`);
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
        return reply({ protocolVersion: negotiate(m.params?.protocolVersion), capabilities: { tools: {} }, serverInfo: { name: "studio", version: "0.2.0" }, instructions: SERVER_INSTRUCTIONS });
      case "notifications/initialized": return;
      case "ping": return reply({});
      case "tools/list": return reply({ tools: byName(await call("/api/tools")) });
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
