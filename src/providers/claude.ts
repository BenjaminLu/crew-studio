// Claude provider: `claude -p --output-format stream-json`, with every built-in
// tool removed and only the Studio MCP server loaded.
//   CREW_CLAUDE_BIN   executable (default "claude"); a .mjs/.ts path runs under bun (test stub)
//   CREW_CLAUDE_MODEL model (default claude-sonnet-5-5)
import { blocksText } from "../tool-content";
import { claudeNeeds } from "./needs";
import { processSession, type LineParser } from "./proc";
import { LOGIN_RE, errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type ToolSpec } from "./types";

export function claudeProvider(model = process.env.CREW_CLAUDE_MODEL ?? "claude-sonnet-5-5", bin = process.env.CREW_CLAUDE_BIN ?? "claude"): Provider {
  return {
    id: "claude", model, envKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR"],
    sandboxNeeds: () => claudeNeeds(bin, ["api.anthropic.com", "console.anthropic.com", "claude.ai", "statsig.anthropic.com", "mcp-proxy.anthropic.com"]),
    start(systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx) {
      const mcp = { mcpServers: { studio: { type: "stdio", command: ctx.mcpCommand[0], args: ctx.mcpCommand.slice(1),
        env: { CREW_STUDIO_URL: ctx.studioUrl, CREW_TOOL_TOKEN: ctx.token } } } };
      const args = ["-p", "{TEXT}", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
        "--tools", "", "--strict-mcp-config", "--mcp-config", JSON.stringify(mcp), "--allowedTools", tools.map((t) => `mcp__studio__${t.name}`).join(","),
        "--system-prompt", systemPrompt, "--disable-slash-commands", "--no-session-persistence", "--restricted"];
      const cmd = () => (/\.(mjs|js|ts)$/.test(bin) ? [process.execPath, bin, ...args] : [bin, ...args]);
      return processSession(cmd, ctx.cwd, ctx.env, parser, ctx.sandbox);
    },
  };
}

const short = (n: string) => n.replace(/^mcp__studio__/, "");
function parser(): LineParser {
  let sawDelta = false, text = "";
  return {
    line(m: any): NEvent[] {
      const out: NEvent[] = [];
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "message_start") sawDelta = false;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) { sawDelta = true; text += ev.delta.text; out.push({ type: "delta", text: ev.delta.text }); }
      } else if (m.type === "assistant") {
        for (const c of m.message?.content ?? []) {
          if (c.type === "tool_use") out.push({ type: "toolStart", id: String(c.id), name: short(String(c.name)), args: c.input ?? {} });
          else if (c.type === "text" && c.text) { if (!sawDelta) { text += c.text; out.push({ type: "delta", text: c.text }); } out.push({ type: "message", text: c.text }); }
        }
      } else if (m.type === "user") {
        for (const c of m.message?.content ?? []) if (c.type === "tool_result") {
          const body = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? blocksText(c.content) : ""; // the CLI saw the picture through MCP; the event keeps a note
          const err = errorOf(body) ?? (c.is_error ? body.slice(0, 200) || "tool error" : null);
          out.push({ type: "toolEnd", id: String(c.tool_use_id), rows: err ? null : rowsOf(body), error: err, result: body });
        }
      } else if (m.type === "result") {
        const r = String(m.result ?? "");
        if (m.is_error || m.subtype !== "success") out.push({ type: "turnEnd", status: "error", code: LOGIN_RE.test(r) ? "notLoggedIn" : "cliError", message: r || "the model run failed" });
        else { if (!text.trim() && r) out.push({ type: "delta", text: r }, { type: "message", text: r });
          const u = m.usage ?? {};
          out.push({ type: "turnEnd", status: "ok", usage: { usd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : null,
            inTokens: typeof u.input_tokens === "number" ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null, outTokens: typeof u.output_tokens === "number" ? u.output_tokens : null } }); }
      }
      return out;
    },
    exit: () => null,
  };
}
