// Codex provider: `codex exec --json`, with its shell, image and web tools off,
// the user's config and rules ignored, a read-only sandbox, and only the Studio
// MCP server registered (for this process only, via -c overrides).
// codex exec --json sends a whole agent message at once, so the reply arrives
// in one piece rather than token by token.
//   CREW_CODEX_BIN    executable (default "codex"); a .mjs/.ts path runs under bun (test stub)
//   CREW_CODEX_MODEL  model (default: the codex CLI's configured default)
import { blocksText } from "../tool-content";
import { codexNeeds, type ApprovedCodexConfig } from "./needs";
import { processSession, type LineParser } from "./proc";
import { LOGIN_RE, errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type ToolSpec } from "./types";

const toml = (s: string) => JSON.stringify(s); // a TOML basic string is a JSON string

export function codexProvider(model = process.env.CREW_CODEX_MODEL ?? "", bin = process.env.CREW_CODEX_BIN ?? "codex", approved?: ApprovedCodexConfig): Provider {
  if (approved && approved.model !== model) throw new Error("approved model snapshot differs from selected Codex model");
  return {
    id: "codex", model: model || "codex default", reasoningEffort: approved?.effort ?? null, envKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"],
    sandboxNeeds: () => codexNeeds(bin, ["api.openai.com", "chatgpt.com", "auth.openai.com"], approved),
    start(systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx) {
      const env = Object.entries({ CREW_STUDIO_URL: ctx.studioUrl, CREW_TOOL_TOKEN: ctx.token }).map(([k, v]) => `${k}=${toml(v)}`).join(",");
      const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-s", "read-only",
        "--disable", "shell_tool", "--disable", "image_generation", "-c", `web_search=${toml("disabled")}`, "-c", `approval_policy=${toml("never")}`,
        "-c", `developer_instructions=${toml(systemPrompt)}`,
        "-c", `mcp_servers.studio.command=${toml(ctx.mcpCommand[0])}`, "-c", `mcp_servers.studio.args=[${ctx.mcpCommand.slice(1).map(toml).join(",")}]`,
        "-c", `mcp_servers.studio.env={${env}}`, "-c", `mcp_servers.studio.default_tools_approval_mode=${toml("approve")}`,
        "-c", `mcp_servers.studio.enabled_tools=[${tools.map((t) => toml(t.name)).join(",")}]`,
        ...(approved ? ["-p", "crew-native"] : []), ...(model ? ["-m", model] : []), "{TEXT}"];
      const cmd = () => (/\.(mjs|js|ts)$/.test(bin) ? [process.execPath, bin, ...args] : [bin, ...args]);
      return processSession(cmd, ctx.cwd, ctx.env, parser, ctx.sandbox);
    },
  };
}

function parser(): LineParser {
  let done = false;
  return {
    line(m: any): NEvent[] {
      const it = m.item ?? {};
      if (m.type === "item.started" && it.type === "mcp_tool_call") return [{ type: "toolStart", id: String(it.id), name: String(it.tool), args: it.arguments ?? {} }];
      if (m.type === "item.completed" && it.type === "mcp_tool_call") {
        const body = Array.isArray(it.result?.content) ? blocksText(it.result.content) : ""; // a picture through MCP: the event keeps a note
        const err = it.error?.message ? String(it.error.message) : errorOf(body);
        return [{ type: "toolEnd", id: String(it.id), rows: err ? null : rowsOf(body), error: err, result: body }];
      }
      if (m.type === "item.completed" && it.type === "agent_message" && it.text) return [{ type: "delta", text: String(it.text) }, { type: "message", text: String(it.text) }];
      if (m.type === "turn.completed") { done = true; const u = m.usage ?? {};
        return [{ type: "turnEnd", status: "ok", usage: { usd: null, inTokens: typeof u.input_tokens === "number" ? u.input_tokens : null, outTokens: typeof u.output_tokens === "number" ? u.output_tokens : null } }]; }
      if (m.type === "turn.failed" || m.type === "error") {
        const msg = String(m.error?.message ?? m.message ?? "the model run failed");
        done = true;
        return [{ type: "turnEnd", status: "error", code: LOGIN_RE.test(msg) ? "notLoggedIn" : "cliError", message: msg }];
      }
      return [];
    },
    exit: () => (done ? { type: "turnEnd", status: "ok" } : null),
  };
}
