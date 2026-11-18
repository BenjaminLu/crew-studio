// What the grant dialog hands the captain to connect an agent CLI to Studio (docs/units/cli-mcp-grant.md "Connecting a
// client"): for each client, the one-line command and the config file entry, all running the same MCP helper with the
// grant's token file (never the token). tests/mcp-sdk-conformance.ts parses every snippet and connects through each with the
// official MCP SDK client.
//   Claude Code   `claude mcp add studio -- <helper>`, or a project's .mcp.json   {"mcpServers": {"studio": {command, args}}}
//   Codex         `codex mcp add studio -- <helper>`, or ~/.codex/config.toml      [mcp_servers.studio] command, args
//   Cursor        .cursor/mcp.json                                                  {"mcpServers": {"studio": {command, args}}}
//   VS Code       .vscode/mcp.json                                                  {"servers": {"studio": {"type": "stdio", command, args}}}

/** A shell word, quoted only when it must be. */
export const shq = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
const tomlString = (s: string) => JSON.stringify(s); // a TOML basic string is a JSON string for every character JSON escapes

export type ClientSnippet = { client: "claude" | "codex" | "cursor" | "vscode"; label: string; command: string | null; file: string; config: string };
/** Every client's snippets for one MCP helper command line (`helper[0]` the program, the rest its arguments). */
export function clientSnippets(helper: string[]): ClientSnippet[] {
  const [command, ...args] = helper, line = helper.map(shq).join(" ");
  const entry = { command, args };
  return [
    { client: "claude", label: "Claude Code", command: `claude mcp add studio -- ${line}`, file: ".mcp.json", config: JSON.stringify({ mcpServers: { studio: entry } }, null, 2) },
    { client: "codex", label: "Codex", command: `codex mcp add studio -- ${line}`, file: "~/.codex/config.toml", config: `[mcp_servers.studio]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(", ")}]\n` },
    { client: "cursor", label: "Cursor", command: null, file: ".cursor/mcp.json", config: JSON.stringify({ mcpServers: { studio: entry } }, null, 2) },
    { client: "vscode", label: "VS Code", command: null, file: ".vscode/mcp.json", config: JSON.stringify({ servers: { studio: { type: "stdio", ...entry } } }, null, 2) },
  ];
}
