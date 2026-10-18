// The chat's model provider interface. Studio never assumes a vendor: each
// provider turns its own CLI or SDK output into these normalized events.
//   start(systemPrompt, tools, ctx) -> Session
//   session.send(text) -> async stream of NEvent, ending with exactly one turnEnd
//   session.interrupt() -> stops the turn; the stream ends with turnEnd{status:"interrupted"}
export type ToolSpec = { name: string; description: string; inputSchema: unknown };
export type TurnStatus = "ok" | "error" | "interrupted";
import type { SandboxNeeds } from "./needs";
export type NEvent =
  | { type: "delta"; text: string }
  | { type: "toolStart"; id: string; name: string; args: unknown }
  | { type: "toolEnd"; id: string; rows: number | null; error: string | null; result: string }
  | { type: "message"; text: string }
  | { type: "turnEnd"; status: TurnStatus; code?: string; message?: string; usage?: Usage };
/** What a turn cost, as the provider reports it (null where it does not say). */
export type Usage = { usd: number | null; inTokens: number | null; outTokens: number | null };

/** Where a provider reaches Studio's tools: an MCP stdio server that calls Studio with a per-question token. */
export type ProviderCtx = { studioUrl: string; token: string;
  /** a 0600 file holding the tool token, readable only inside this round's sandbox: the CLI providers hand the MCP server
   *  CREW_TOOL_TOKEN_FILE=this instead of putting the token on their argv, where any same-uid process could read it */
  tokenFile?: string | null; cwd: string; mcpCommand: string[]; env: Record<string, string>;
  /** an agent round: the process runs under this sandbox profile (architecture §10) */
  sandbox?: { profile: string } | null;
  /** an in-process provider in a sandboxed round: its requests go through this proxy URL (with the round's credential) */
  proxy?: string | null };

export interface Session { send(text: string): AsyncIterable<NEvent>; interrupt(): void }
export interface Provider {
  readonly id: string;
  readonly model: string;
  /** Existing approved native configuration, never a new effort choice. */
  readonly reasoningEffort?: string | null;
  /** the environment variables this provider's own process needs (its key and config), and nothing else */
  readonly envKeys?: string[];
  /** a CLI provider in a sandboxed round: the folders it reads and writes (its install and config) and the hosts it calls */
  readonly sandboxNeeds?: () => SandboxNeeds;
  /** a provider that runs in Studio's own process and spawns nothing (the stub): a sandboxed round runs it as is */
  readonly sandboxFree?: boolean;
  start(systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx): Session;
}

/** Row count of a tool result, for the chat's lookup chips. */
export function rowsOf(text: string): number | null {
  try {
    const o = JSON.parse(text);
    if (Array.isArray(o)) return o.length;
    if (o && typeof o === "object") {
      if (o.error) return null;
      for (const k of ["code", "lastEvents", "lines", "files"]) if (Array.isArray(o[k])) return o[k].length;
      return 1;
    }
  } catch {}
  return null;
}
export const errorOf = (text: string): string | null => { try { const o = JSON.parse(text); return o?.error ? String(o.error) : null; } catch { return null; } };
export const LOGIN_RE = /not logged in|log ?in required|please run \/?login|invalid api key|authenticat|unauthori[sz]ed|credential|oauth|401/i;
