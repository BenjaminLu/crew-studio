# Crew Studio plug-in (Claude Code and Codex)

One folder, two manifests: `.claude-plugin/plugin.json` (Claude Code) and `.codex-plugin/plugin.json` (Codex). Both bring
the `studio` MCP server (`.mcp.json`: `crew-studio mcp`) and the `studio` skill (`skills/studio/SKILL.md`, generated from
`src/observe/` by `bun scripts/observe-index.ts --write`).

1. On Studio's board, Settings → External CLI grants: issue a grant (for reading, **Read Studio**).
2. Point the plug-in at the grant's file, in the shell you start the CLI from:
   `export CREW_STUDIO_GRANT_FILE=<the grant file the board shows>`; when Studio is not on port 4210, also
   `export CREW_STUDIO_URL=http://127.0.0.1:<port>`. `crew-studio` must be on your PATH.
3. Claude Code: `/plugin marketplace add BenjaminLu/crew-studio`, then `/plugin install crew-studio@crew-studio`.
   Codex: add this folder as a plug-in (see Codex's plug-in docs).

Without a plug-in, the grant dialog gives each client's own command and config entry (Claude Code, Codex, Cursor, VS Code).
The grant decides what the tools read; revoking it on the board stops them.
