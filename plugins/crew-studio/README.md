# Crew Studio plug-in (Claude Code and Codex)

One folder, two manifests: `.claude-plugin/plugin.json` (Claude Code) and `.codex-plugin/plugin.json` (Codex). Both bring
the `studio` MCP server (`.mcp.json`) and the `studio` skill (`skills/studio/SKILL.md`). Both files are generated from
`src/observe/` by `bun scripts/observe-index.ts --write`.

1. On Studio's board, go to Settings → External CLI grants and issue a grant (to read Studio: **Read Studio**).
2. Open the grant's **Plug-in** tab and copy its lines into the shell profile you start the CLI from:
   - `CREW_STUDIO_GRANT_FILE`: the grant's token file.
   - `CREW_STUDIO_URL`: only when Studio is not on port 4210.
   - Where Studio is: `CREW_STUDIO_BIN` (the Studio binary) or `CREW_STUDIO_SRC` (a source checkout, run with bun).

   Nothing has to be on your PATH. Without these lines the server stops at once and says which one is missing.
3. Install:
   - **Claude Code:** `/plugin marketplace add <this repository: its GitHub owner/name, or a local clone>`, then
     `/plugin install crew-studio@crew-studio`. To try it without installing: `claude --plugin-dir <clone>/plugins/crew-studio`.
   - **Codex:** `codex plugin marketplace add <this repository, or a local clone>`, then `codex plugin add crew-studio@crew-studio`.

Without a plug-in, the grant dialog gives each client's own user-scope command and config entry (Claude Code, Codex,
Cursor, VS Code). These hold this Mac's paths, so keep them out of project files. The grant decides what the tools read,
and revoking it on the board stops them.
