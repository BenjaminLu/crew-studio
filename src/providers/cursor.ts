import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// Cursor provider: `cursor-agent -p --output-format stream-json` in a private root of its own (needs.ts cursorRoot):
// HOME, workspace and CURSOR_DATA_DIR are throwaway folders, so neither the user's ~/.cursor nor a repository's .cursor/
// is ever read. The workspace's .cursor/mcp.json registers only the Studio MCP server; its cli-config.json allows
// exactly this turn's Studio tools and denies every built-in Shell, Read and Write, so the agent works through Studio
// alone (as the claude provider does with --tools ""). cursor-agent takes no system prompt flag: the workspace's
// AGENTS.md carries it. Its own sandbox stays off (it cannot start inside sandbox-exec, v1 T-105); a sandboxed round's
// OS profile confines the process. It signs in with a Cursor API key only (login.ts cursorLogin).
//   CREW_CURSOR_BIN    executable (default "cursor-agent"); a .mjs/.ts path runs under bun (test stub)
//   CREW_CURSOR_MODEL  model (default: cursor-agent's own default)
import { blocksText } from "../tool-content";
import { cursorLogin } from "./login";
import { cursorNeeds, cursorRoot } from "./needs";
import { processSession, type LineParser } from "./proc";
import type { ProviderCapability } from "./policy";
import { LOGIN_RE, errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type ToolSpec } from "./types";

export const CURSOR_HOSTS = ["api2.cursor.sh", "agentn.global.api5.cursor.sh"];

/** The model Studio runs Cursor on: the captain's saved choice, else CREW_CURSOR_MODEL, else Composer. */
export const cursorModel = (saved?: string | null) => saved || process.env.CREW_CURSOR_MODEL || "composer-2.5";

/** Native capability for the provider policy without a model request: the CLI is on disk and an API key is present
 *  (existence only: the keychain is asked whether the item exists, never for the secret). Cursor reports no quota or
 *  reasoning-effort levels, so a present key counts as available and every model runs with effort null. */
export function probeCursor(models: string[], bin = process.env.CREW_CURSOR_BIN ?? "cursor-agent"): ProviderCapability {
  const at = Date.now(), base = { provider: "cursor", at, expires: at + 30_000 };
  if (!(bin.includes("/") ? existsSync(bin) : Bun.which(bin))) return { ...base, available: false, auth: "unverified", quota: "unknown", models: [], refusal: "unavailable", reason: "the Cursor CLI (cursor-agent) is not installed" };
  if (!cursorLogin({ probe: true }).ok) return { ...base, available: true, auth: "missing", quota: "unknown", models: [], refusal: "missing-login", reason: "no Cursor API key (keychain item crew-studio-cursor-api-key or firstmate-cursor-api-key, ~/.config/crew-studio/cursor-api-key, then CURSOR_API_KEY in Studio's environment)" };
  return { ...base, available: true, auth: "verified", quota: "available", models: [...new Set(models.filter(Boolean))].map((id) => ({ id, efforts: [] })) };
}

/** The per-turn configuration cursor-agent reads from its private root. */
export function writeCursorConfig(root: string, systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx) {
  const mcp = { mcpServers: { studio: { command: ctx.mcpCommand[0], args: ctx.mcpCommand.slice(1), env: { CREW_STUDIO_URL: ctx.studioUrl, CREW_TOOL_TOKEN_FILE: ctx.tokenFile! } } } };
  writeFileSync(join(root, "w", ".cursor", "mcp.json"), JSON.stringify(mcp), { mode: 0o600 });
  const permissions = { allow: tools.map((t) => `Mcp(studio:${t.name})`), deny: ["Shell(*)", "Read(**)", "Write(**)"] };
  // with XDG_CONFIG_HOME set (a sandboxed round sets it) cursor-agent reads $XDG_CONFIG_HOME/cursor/, never ~/.cursor/
  writeFileSync(join(root, "h", ".config", "cursor", "cli-config.json"), JSON.stringify({ version: 1, permissions }), { mode: 0o600 });
  writeFileSync(join(root, "w", "AGENTS.md"), systemPrompt, { mode: 0o600 });
}

export function cursorProvider(model = process.env.CREW_CURSOR_MODEL ?? "", bin = process.env.CREW_CURSOR_BIN ?? "cursor-agent"): Provider {
  return {
    // no envKeys: a turn never takes CURSOR_API_KEY straight from Studio's environment; cursorLogin picks the key, keychain first
    id: "cursor", model: model || "cursor default", envKeys: [],
    sandboxNeeds: () => cursorNeeds(bin, CURSOR_HOSTS),
    start(systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx) {
      if (!ctx.tokenFile) throw new Error("Cursor provider requires a private tool-token file");
      // a sandboxed round made the root when it set up the round's home; a chat turn makes and removes its own
      const owned = !ctx.env.CREW_CURSOR_ROOT, root = ctx.env.CREW_CURSOR_ROOT || cursorRoot();
      const drop = () => { if (owned) try { rmSync(root, { recursive: true, force: true }); } catch {} };
      try { writeCursorConfig(root, systemPrompt, tools, ctx); } catch (e) { drop(); throw e; }
      const env: Record<string, string> = { ...ctx.env, HOME: join(root, "h"), XDG_CONFIG_HOME: join(root, "h", ".config"), CURSOR_DATA_DIR: join(root, "d"), AGENT_CLI_CREDENTIAL_STORE: "memory" };
      if (!env.CURSOR_API_KEY) { const login = cursorLogin(); if (login.ok) Object.assign(env, login.env); }
      const args = ["-p", "--output-format", "stream-json", "--trust", "--approve-mcps", "--sandbox", "disabled", "--workspace", join(root, "w"), ...(model ? ["--model", model] : []), "{TEXT}"];
      const cmd = () => (/\.(mjs|js|ts)$/.test(bin) ? [process.execPath, bin, ...args] : [bin, ...args]);
      const session = processSession(cmd, join(root, "w"), env, parser, ctx.sandbox);
      return { interrupt() { session.interrupt(); drop(); }, async *send(text: string) { try { yield* session.send(text); } finally { drop(); } } };
    },
  };
}

/** cursor-agent's tool-call result for an MCP call: its text blocks, and whether it failed (an error, a rejection, a denial). */
function mcpOutcome(result: any): { body: string; err: string | null } {
  if (result?.success) {
    const blocks = (Array.isArray(result.success.content) ? result.success.content : []).map((b: any) => b?.text && typeof b.text === "object" ? { type: "text", text: String(b.text.text ?? "") } : b);
    const body = blocksText(blocks);
    return { body, err: result.success.isError ? errorOf(body) ?? (body.slice(0, 200) || "tool error") : errorOf(body) };
  }
  const why = result?.rejected?.reason ?? result?.permissionDenied?.error ?? result?.error?.errorMessage ?? "the tool call did not complete";
  return { body: JSON.stringify({ error: String(why) }), err: String(why) };
}

function parser(): LineParser {
  let done = false, text = "";
  return {
    line(m: any): NEvent[] {
      if (m.type === "assistant") {
        const out: NEvent[] = [];
        for (const c of m.message?.content ?? []) if (c?.type === "text" && c.text) { text += c.text; out.push({ type: "delta", text: c.text }, { type: "message", text: c.text }); }
        return out;
      }
      const call = m.type === "tool_call" ? m.tool_call?.mcpToolCall : null;
      if (call && m.subtype === "started") return [{ type: "toolStart", id: String(m.call_id), name: String(call.args?.toolName ?? ""), args: call.args?.args ?? {} }];
      if (call && m.subtype === "completed") { const r = mcpOutcome(call.result); return [{ type: "toolEnd", id: String(m.call_id), rows: r.err ? null : rowsOf(r.body), error: r.err, result: r.body }]; }
      if (m.type === "result") {
        done = true;
        const r = String(m.result ?? "");
        if (m.is_error || m.subtype !== "success") return [{ type: "turnEnd", status: "error", code: LOGIN_RE.test(r) ? "notLoggedIn" : "cliError", message: r || "the model run failed" }];
        const u = m.usage ?? {}, n = (v: unknown) => (typeof v === "number" ? v : 0);
        return [...(!text.trim() && r ? [{ type: "delta", text: r } as NEvent, { type: "message", text: r } as NEvent] : []),
          { type: "turnEnd", status: "ok", usage: { usd: null, inTokens: typeof u.inputTokens === "number" ? n(u.inputTokens) + n(u.cacheReadTokens) + n(u.cacheWriteTokens) : null, outTokens: typeof u.outputTokens === "number" ? u.outputTokens : null } }];
      }
      return [];
    },
    exit: () => (done ? { type: "turnEnd", status: "ok" } : null),
  };
}
