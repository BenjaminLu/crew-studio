// Where Studio runs from: a source checkout (`bun src/server.ts`) or the single
// compiled binary (`dist/crew-studio`). The binary carries its web assets and
// starts its own helper processes (`crew-studio mcp`, `crew-studio permission-mcp`),
// so it needs no Bun on PATH.
import { homedir } from "node:os";
import { basename, join } from "node:path";

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
/** A provider CLI given as a script (a .js, .mjs or .ts file: tests and stand-ins) runs under this runtime. */
export const isScriptBin = (bin: string) => /\.(?:mjs|js|ts)$/.test(bin);
/** This process is bun itself (a source checkout), not the compiled binary, which takes no bun flags. */
const RUNS_ON_BUN = /^bun(?:\.exe)?$/.test(basename(process.execPath));
/** argv that runs a provider CLI in an agent's folder: a script under this bun, which then reads no bunfig.toml or .env of
 *  that folder (BUN_ISOLATED); any other CLI as it is. */
export function scriptArgv(bin: string, args: string[]): string[] { return isScriptBin(bin) ? [process.execPath, ...(RUNS_ON_BUN ? BUN_ISOLATED : []), bin, ...args] : [bin, ...args]; }
export function helperCommand(name: "mcp" | "permission-mcp" | "check-script", args: string[] = []): string[] {
  return COMPILED ? [process.execPath, name, ...args] : [process.execPath, ...BUN_ISOLATED, join(SRC_ROOT, "src", `${name}.ts`), ...args];
}
