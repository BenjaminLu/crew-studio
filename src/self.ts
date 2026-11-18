// Where Studio runs from: a source checkout (`bun src/server.ts`) or the single
// compiled binary (`dist/crew-studio`). The binary carries its web assets and
// starts its own helper processes (`crew-studio mcp`, `crew-studio permission-mcp`),
// so it needs no Bun on PATH.
import { homedir } from "node:os";
import { join } from "node:path";

export const COMPILED = import.meta.path.includes("$bunfs") || import.meta.path.includes("~BUN");
/** The source checkout root (meaningless inside the binary). */
export const SRC_ROOT = join(import.meta.dir, "..");
/** One Studio-owned store for source and binary; CREW_DATA explicitly selects another. */
export const DEFAULT_DATA = join(homedir(), ".crew-studio", "data");
/** argv that runs one of Studio's helpers (an MCP stdio server) with the same runtime. */
/** What Studio's own helpers (the MCP tool server) read inside a sandboxed round: the binary, or the source folder. */
export function helperReads(): string[] { return COMPILED ? [process.execPath] : [join(SRC_ROOT, "src"), join(SRC_ROOT, "package.json")]; }
/** The flags bun gets whenever Studio starts it in a folder Studio does not own (an agent's worktree, the folder an agent
 *  runs the CLI in): that folder's bunfig.toml (a preload runs in the same process that reads a token) and .env (it could
 *  set CREW_STUDIO_GRANT) are never read. The binary is built without either (scripts/build.ts). */
export const BUN_ISOLATED = ["--no-env-file", "--config=/dev/null"] as const;
export function helperCommand(name: "mcp" | "permission-mcp" | "check-script", args: string[] = []): string[] {
  return COMPILED ? [process.execPath, name, ...args] : [process.execPath, ...BUN_ISOLATED, join(SRC_ROOT, "src", `${name}.ts`), ...args];
}
