// The stdio MCP server Claude's --permission-prompt-tool calls for every tool
// permission request of the attached main session. It forwards the request to
// Studio over a private unix socket with a token and returns Studio's answer.
// Any failure - no socket, bad token, timeout - returns deny.
//   CREW_PERM_SOCKET  socket path;  CREW_PERM_TOKEN  token
import { connect } from "node:net";
import { createInterface } from "node:readline";

const SOCKET = process.env.CREW_PERM_SOCKET ?? "", TOKEN = process.env.CREW_PERM_TOKEN ?? "";
const TIMEOUT = Number(process.env.CREW_PERM_TIMEOUT_MS ?? 125_000);
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
const summarize = (input: any) => { const v = input?.command ?? input?.file_path ?? input?.path ?? input?.pattern ?? input?.url ?? JSON.stringify(input ?? ""); return String(v).slice(0, 200); };

function ask(name: string, input: unknown, id: string): Promise<{ allow: boolean; message?: string; updatedInput?: unknown }> {
  return new Promise((resolve) => {
    let done = false, buf = "";
    const finish = (a: { allow: boolean; message?: string; updatedInput?: unknown }) => { if (done) return; done = true; clearTimeout(t); try { s.destroy(); } catch {} resolve(a); };
    const t = setTimeout(() => finish({ allow: false, message: "Crew Studio did not answer in time" }), TIMEOUT);
    const s = connect(SOCKET);
    s.on("connect", () => s.write(JSON.stringify({ token: TOKEN, tool_name: name, input, tool_use_id: id, summary: summarize(input) }) + "\n"));
    s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { const a = JSON.parse(buf.slice(0, i)); finish({ allow: a.allow === true, message: a.message, updatedInput: a.updatedInput && typeof a.updatedInput === "object" ? a.updatedInput : undefined }); } catch { finish({ allow: false, message: "bad answer" }); } } });
    s.on("error", () => finish({ allow: false, message: "Crew Studio is not reachable" }));
    s.on("close", () => finish({ allow: false, message: "Crew Studio closed the connection" }));
  });
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let m: any; try { m = JSON.parse(line); } catch { return; }
  const reply = (result: unknown) => { if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, result }); };
  switch (m.method) {
    case "initialize": return reply({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "studio_permission", version: "0.3.0" } });
    case "notifications/initialized": return;
    case "ping": return reply({});
    case "tools/list": return reply({ tools: [{ name: "approve", description: "Ask the captain in Crew Studio whether this tool call may run.",
      inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } }, required: ["tool_name", "input"] } }] });
    case "tools/call": {
      const a = m.params?.arguments ?? {};
      const ans = await ask(String(a.tool_name ?? "tool"), a.input ?? {}, String(a.tool_use_id ?? ""));
      const body = ans.allow ? { behavior: "allow", updatedInput: ans.updatedInput ?? a.input ?? {} } : { behavior: "deny", message: ans.message ?? "denied" };
      return reply({ content: [{ type: "text", text: JSON.stringify(body) }] });
    }
    default: if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
  }
});
