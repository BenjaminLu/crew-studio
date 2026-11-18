// What the grant dialog hands the captain to connect an agent CLI to Studio (docs/units/cli-mcp-grant.md "Connecting a
// client"): for each client, the one-line command and the config file entry, all running the same MCP helper with the
// grant's token file (never the token). They are user-scope: a config holds this Mac's absolute paths, so it belongs in the
// captain's own settings, never in a project file that may be committed. tests/mcp-sdk-conformance.ts parses every snippet
// and connects through each with the official MCP SDK client.
//   Claude Code   `claude mcp add --scope user studio -- <helper>`, or ~/.claude.json's "mcpServers"
//   Codex         `codex mcp add studio -- <helper>`, or ~/.codex/config.toml   [mcp_servers.studio] command, args
//   Cursor        ~/.cursor/mcp.json                                            {"mcpServers": {"studio": {command, args}}}
//   VS Code       the user mcp.json (MCP: Open User Configuration)              {"servers": {"studio": {"type": "stdio", command, args}}}
//   Plug-in       the shell lines the crew-studio plug-in reads (CREW_STUDIO_GRANT_FILE, CREW_STUDIO_URL, CREW_STUDIO_BIN or _SRC)

/** A shell word, quoted only when it must be. */
export const shq = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
const tomlString = (s: string) => JSON.stringify(s); // a TOML basic string is a JSON string for every character JSON escapes

export type ClientSnippet = { client: "claude" | "codex" | "cursor" | "vscode" | "plugin"; label: string; command: string | null; file: string; config: string };
/** Where the helper runs from, for the plug-in: the Studio binary, or a source checkout (bun <checkout>/src/mcp.ts). */
export type HelperHome = { bin: string } | { src: string };
/** Every client's snippets for one MCP helper command line (`helper[0]` the program, the rest its arguments). */
export function clientSnippets(helper: string[], plugin?: { grantFile: string; url: string | null; home: HelperHome }): ClientSnippet[] {
  const [command, ...args] = helper, line = helper.map(shq).join(" ");
  const entry = { command, args };
  return [
    { client: "claude", label: "Claude Code", command: `claude mcp add --scope user studio -- ${line}`, file: "~/.claude.json (user scope)", config: JSON.stringify({ mcpServers: { studio: { type: "stdio", ...entry } } }, null, 2) },
    { client: "codex", label: "Codex", command: `codex mcp add studio -- ${line}`, file: "~/.codex/config.toml", config: `[mcp_servers.studio]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(", ")}]\n` },
    { client: "cursor", label: "Cursor", command: null, file: "~/.cursor/mcp.json", config: JSON.stringify({ mcpServers: { studio: entry } }, null, 2) },
    { client: "vscode", label: "VS Code", command: null, file: "the user mcp.json (MCP: Open User Configuration)", config: JSON.stringify({ servers: { studio: { type: "stdio", ...entry } } }, null, 2) },
    ...(plugin ? [{ client: "plugin" as const, label: "Plug-in", command: null, file: "your shell profile, for the crew-studio plug-in",
      config: [`export CREW_STUDIO_GRANT_FILE=${shq(plugin.grantFile)}`, ...(plugin.url ? [`export CREW_STUDIO_URL=${shq(plugin.url)}`] : []),
        "bin" in plugin.home ? `export CREW_STUDIO_BIN=${shq(plugin.home.bin)}` : `export CREW_STUDIO_SRC=${shq(plugin.home.src)}`].join("\n") + "\n" }] : []),
  ];
}
/** The plug-in's server (plugins/crew-studio/.mcp.json): a resolver that needs nothing on PATH. CREW_STUDIO_BIN (the binary)
 *  or CREW_STUDIO_SRC (a checkout, run with bun) say where Studio is; `crew-studio` on PATH also works; else it says so. */
export const PLUGIN_SERVER = { type: "stdio", command: "sh", args: ["-c",
  'if [ -n "$CREW_STUDIO_BIN" ]; then exec "$CREW_STUDIO_BIN" mcp; elif [ -n "$CREW_STUDIO_SRC" ]; then exec bun "$CREW_STUDIO_SRC/src/mcp.ts"; elif command -v crew-studio >/dev/null 2>&1; then exec crew-studio mcp; else echo "crew-studio mcp: Studio not found: set CREW_STUDIO_BIN to the Studio binary or CREW_STUDIO_SRC to a checkout (the grant dialog Plug-in tab shows both)" >&2; exit 127; fi'] };
