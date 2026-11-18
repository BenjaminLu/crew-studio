// MCP protocol version negotiation shared by Studio's stdio MCP servers (src/mcp.ts, src/permission-mcp.ts).
// Both use only initialize, tools/list, tools/call, text and image content and server instructions, all present
// since 2024-11-05, so each version below is really implemented, not echoed.

/** MCP protocol versions Studio's stdio servers implement, oldest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"] as const;

/** The version to answer initialize with: the client's own when supported, otherwise the newest here (an unknown one
 *  such as 2026-07-28, a malformed one or none), as the MCP spec's version negotiation says. */
export const negotiateProtocolVersion = (asked: unknown): string =>
  SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === asked) ?? SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
