import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeProcess } from "./probe-process";
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

const installed = (bin: string) => !!(bin.includes("/") ? existsSync(bin) : Bun.which(bin));

/** `cursor-agent models`: the account's models, one per line (`<id> - <name> (current, default)`) between an
 *  "Available models" heading and a closing Tip. */
export function parseCursorModels(text: string): string[] {
  const ids: string[] = [];
  for (const raw of text.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    const line = raw.trim(), id = /^([\w.:\[\]=,-]{1,120})(?:\s+-\s|\s+\(|$)/.exec(line)?.[1];
    if (!id || /^(Available|Tip|No)$/i.test(id) || /^(Available models|Tip:|No models)/i.test(line) || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

/** The last bounded check of the crew's key: `cursor-agent models` signed in with it succeeded (ok) or not, for this CLI and
 *  this key source. A check that passed holds for CHECK_MS, one that failed for FAILED_MS (it is not retried sooner). The key
 *  is read for the check only and never kept; a key replaced in the same place is checked again within CHECK_MS. */
type CursorCheck = { bin: string; source: string; ok: boolean; models: string[]; reason: string | null; at: number };
const CHECK_MS = 10 * 60_000, FAILED_MS = 30_000;
let lastCheck: CursorCheck | null = null, checking: Promise<CursorCheck | null> | null = null;
const checkFor = (bin: string, source: string | undefined) => lastCheck && lastCheck.bin === bin && lastCheck.source === source && Date.now() - lastCheck.at < (lastCheck.ok ? CHECK_MS : FAILED_MS) ? lastCheck : null;

/** Native capability for the provider policy without a model request: the CLI is on disk and an API key is present
 *  (existence only: the keychain is asked whether the item exists, never for the secret). A present key stays unverified,
 *  as a Claude login does until Verify, until a bounded `cursor-agent models` check with it succeeds (verifyCursor); then
 *  its models are the ones that check listed (else `models`, Studio's configured one). Cursor reports no quota or
 *  reasoning-effort levels: a verified key counts as available and every model runs with effort null. */
export function probeCursor(models: string[], bin = process.env.CREW_CURSOR_BIN ?? "cursor-agent"): ProviderCapability {
  const at = Date.now(), base = { provider: "cursor", at, expires: at + 30_000 };
  if (!installed(bin)) return { ...base, available: false, auth: "unverified", quota: "unknown", models: [], refusal: "unavailable", reason: "the Cursor CLI (cursor-agent) is not installed" };
  const login = cursorLogin({ probe: true });
  if (!login.ok) return { ...base, available: true, auth: "missing", quota: "unknown", models: [], refusal: "missing-login", reason: "no Cursor API key (keychain item crew-studio-cursor-api-key or firstmate-cursor-api-key, ~/.config/crew-studio/cursor-api-key, then CURSOR_API_KEY in Studio's environment)" };
  const check = checkFor(bin, login.source);
  if (!check?.ok) return { ...base, available: true, auth: "unverified", quota: "unknown", models: [], refusal: "unverified",
    reason: check ? `Cursor did not accept the crew's API key (${check.reason}); fix the key, then check again` : "a Cursor API key is present but not verified yet: Studio checks it with `cursor-agent models` (no model request)" };
  const listed = check.models.length ? check.models : models.filter(Boolean);
  return { ...base, available: true, auth: "verified", quota: "available", models: [...new Set(listed)].map((id) => ({ id, efforts: [] })) };
}

/** The bounded real check: `cursor-agent models` signed in with the crew's key, in a throwaway root (private HOME, config and
 *  data, an in-memory credential store), at most `timeoutMs` and 256 KB of output. It lists the account's models and fails
 *  when the key is refused; it makes no model request. One check runs at a time; a recent result is reused unless `fresh`. */
export async function verifyCursor(o: { bin?: string; fresh?: boolean; timeoutMs?: number } = {}): Promise<CursorCheck | null> {
  const bin = o.bin ?? process.env.CREW_CURSOR_BIN ?? "cursor-agent";
  if (!installed(bin)) return null;
  const probe = cursorLogin({ probe: true });
  if (!probe.ok) return null;
  if (!o.fresh) { const c = checkFor(bin, probe.source); if (c) return c; }
  if (checking) return checking;
  checking = (async () => {
    const login = cursorLogin();
    if (!login.ok) return null;
    const root = mkdtempSync(join(tmpdir(), "crew-cursor-check-"));
    for (const d of ["h/.config", "d", "t"]) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
    const env = { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "en_US.UTF-8", NO_COLOR: "1", HOME: join(root, "h"), XDG_CONFIG_HOME: join(root, "h", ".config"), CURSOR_DATA_DIR: join(root, "d"), TMPDIR: join(root, "t"), AGENT_CLI_CREDENTIAL_STORE: "memory", ...login.env };
    let result: CursorCheck = { bin, source: login.source ?? "", ok: false, models: [], reason: "the check did not finish", at: Date.now() }, clean = true;
    const proc = probeProcess(/\.(mjs|js|ts)$/.test(bin) ? [process.execPath, bin, "models"] : [bin, "models"], root, env, undefined, { timeoutMs: o.timeoutMs ?? 20_000, bytes: 256 * 1024 });
    try {
      const code = await proc.exited; await proc.stop();
      const { out, err, failure } = proc.output();
      const why = failure ?? (code !== 0 ? (LOGIN_RE.test(out + err) ? "authentication failed" : `cursor-agent models exited ${code}`) : null);
      result = { ...result, ok: !why, models: why ? [] : parseCursorModels(out), reason: why, at: Date.now() };
    } catch { clean = false; }
    if (clean) try { rmSync(root, { recursive: true, force: true }); } catch {}
    lastCheck = result; return result;
  })().finally(() => { checking = null; });
  return checking;
}

/** What the last check said about the crew's key for this CLI (read only, never a check): passed, failed with why, or unchecked. */
export function cursorKeyCheck(bin = process.env.CREW_CURSOR_BIN ?? "cursor-agent"): { state: "passed" | "failed" | "unchecked"; reason: string | null } {
  const login = cursorLogin({ probe: true }), c = login.ok ? checkFor(bin, login.source) : null;
  return !c ? { state: "unchecked", reason: null } : { state: c.ok ? "passed" : "failed", reason: c.reason };
}

/** probeCursor after the bounded check when the key has not been checked yet (or a passed check ran out). */
export async function probeCursorChecked(models: string[], bin = process.env.CREW_CURSOR_BIN ?? "cursor-agent"): Promise<ProviderCapability> {
  const cap = probeCursor(models, bin);
  if (cap.auth !== "unverified" || !cap.available) return cap;
  await verifyCursor({ bin });
  return probeCursor(models, bin);
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
