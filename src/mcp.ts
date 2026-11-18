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
//   CREW_STUDIO_GRANT_FILE=<path>  the grant file when no --grant-file is given (the Claude Code and Codex plug-in, plugins/crew-studio)
import { mcpContent } from "./tool-content";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { SERVER_INSTRUCTIONS } from "./observe/instructions";
import { negotiateProtocolVersion } from "./mcp-protocol";

// one fixed order whatever order Studio answers in, so a client's prompt cache sees the same tool list every time
const byName = (tools: any) => Array.isArray(tools) ? [...tools].sort((a, b) => { const x = String(a?.name ?? ""), y = String(b?.name ?? ""); return x < y ? -1 : x > y ? 1 : 0; }) : tools;

const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] ?? "" : null; };
// a plug-in (plugins/crew-studio/.mcp.json) cannot know the grant file: it comes from CREW_STUDIO_GRANT_FILE in the CLI's environment
const GRANT_FILE = flag("--grant-file") ?? (!process.env.CREW_TOOL_TOKEN_FILE && !process.env.CREW_TOOL_TOKEN && !process.env.CREW_STUDIO_SOCKET ? process.env.CREW_STUDIO_GRANT_FILE || null : null);
if (GRANT_FILE === "") { process.stderr.write("crew-studio mcp: --grant-file needs a path\n"); process.exit(2); }
const URL_ = flag("--url") || process.env.CREW_STUDIO_URL || "http://127.0.0.1:4210";
const readToken = (f: string) => { try { return readFileSync(f, "utf8").trim(); } catch { return ""; } };
// a Studio-owned session hands the token as a 0600 file (CREW_TOOL_TOKEN_FILE), so it is never on a command line; so does a grant
const TOKEN = GRANT_FILE ? readToken(GRANT_FILE) : process.env.CREW_TOOL_TOKEN_FILE ? readToken(process.env.CREW_TOOL_TOKEN_FILE) : process.env.CREW_TOOL_TOKEN ?? "";
// no grant file, no token and no socket: a plug-in started without CREW_STUDIO_GRANT_FILE. Say so now, not on tools/list
if (!GRANT_FILE && !TOKEN && !process.env.CREW_STUDIO_SOCKET) { process.stderr.write("crew-studio mcp: no grant: set CREW_STUDIO_GRANT_FILE to the grant file Studio's board shows (Settings, External CLI grants), or pass --grant-file <path>\n"); process.exit(2); }
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

/** studio_get as a resource template: studio://{kind}/{id} */
const RESOURCE_TEMPLATE = { uriTemplate: "studio://{kind}/{id}", name: "studio-entity", title: "A Studio entity", description: "One Task, card, review room, pull request, workflow, skill or other Studio entity, as studio_get reads it (kind:id refs, e.g. studio://task/R-162).", mimeType: "application/json" };
/** the tools whose results go as structuredContent (those with an outputSchema), from the last tools/list */
let structured: Set<string> | null = null;
const listStructured = async () => { try { const t = await call("/api/tools"); return new Set<string>((Array.isArray(t) ? t : []).filter((x: any) => x?.outputSchema).map((x: any) => x.name)); } catch { return new Set<string>(); } };
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  const reply = (result: unknown) => { if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, result }); };
  const fail = (code: number, message: string) => { if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code, message } }); };
  try {
    switch (m.method) {
      case "initialize":
        return reply({ protocolVersion: negotiateProtocolVersion(m.params?.protocolVersion), capabilities: { tools: {}, resources: {} }, serverInfo: { name: "studio", version: "0.2.0" }, instructions: SERVER_INSTRUCTIONS });
      case "notifications/initialized": return;
      case "ping": return reply({});
      case "tools/list": { const tools = byName(await call("/api/tools")); structured = new Set((Array.isArray(tools) ? tools : []).filter((t: any) => t?.outputSchema).map((t: any) => t.name)); return reply({ tools }); }
      // resources: studio://{kind}/{id} mirrors studio_get (src/observe/tools.ts), so a client can attach a room or a Task as
      // context; offered only where this session has studio_get. Nothing is listed up front: studio_find and studio_list
      // return resource links.
      case "resources/list": return reply({ resources: [] });
      case "resources/templates/list": { const tools = await call("/api/tools"); const has = Array.isArray(tools) && tools.some((t: any) => t?.name === "studio_get");
        return reply({ resourceTemplates: has ? [RESOURCE_TEMPLATE] : [] }); }
      case "resources/read": {
        const uri = String(m.params?.uri ?? ""); if (!/^studio:\/\/[a-z][a-z-]{1,20}\/.+/.test(uri)) return fail(-32602, "a Studio resource is studio://kind/id (studio://task/R-162)");
        const r = await call("/api/tools/studio_get", { ref: uri });
        if (!r || typeof r !== "object" || r.error) return fail(-32002, `Resource not found: ${uri}${r?.error ? ` (${String(r.error).slice(0, 300)})` : ""}`);
        const { _meta, ...data } = r as any;
        return reply({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }], ...(_meta ? { _meta } : {}) });
      }
      case "tools/call": {
        const name = String(m.params?.name ?? "");
        const r = await call(`/api/tools/${encodeURIComponent(name)}`, m.params?.arguments ?? {});
        // a read tool (src/observe/tools.ts) declares an outputSchema: its result also goes as structuredContent, its trust note
        // (_meta["studio/trust"]) as the result's _meta; the text copy stays for a client that reads only content
        if (!r?.error && r && typeof r === "object" && (structured ??= await listStructured()).has(name)) { const { _meta, ...data } = r as any;
          // a search's hits also go as resource_link content blocks (studio://kind/id), the form MCP clients list as links
          const links = (Array.isArray(data.items) ? data.items : []).map((x: any) => x?.resource_link).filter((l: any) => l?.type === "resource_link" && typeof l.uri === "string");
          return reply({ content: [{ type: "text", text: JSON.stringify(data) }, ...links], structuredContent: data, isError: false, ...(_meta ? { _meta } : {}) }); }
        return reply({ content: mcpContent(r), isError: !!r?.error }); // a picture (a reviewer's image read) goes as an image block
      }
      default: return fail(-32601, `unknown method ${m.method}`);
    }
  } catch (e: any) {
    if (m.method === "tools/call") return reply({ content: [{ type: "text", text: JSON.stringify({ error: String(e?.message ?? e) }) }], isError: true });
    fail(-32603, String(e?.message ?? e));
  }
});
