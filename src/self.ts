// Where Studio runs from: a source checkout (`bun src/server.ts`) or the single
// compiled binary (`dist/crew-studio`). The binary carries its web assets and
// starts its own helper processes (`crew-studio mcp`, `crew-studio permission-mcp`),
// so it needs no Bun on PATH.
import { homedir } from "node:os";
import { join } from "node:path";

export const COMPILED = import.meta.path.includes("$bunfs") || import.meta.path.includes("~BUN");
/** The source checkout root (meaningless inside the binary). */
export const SRC_ROOT = join(import.meta.dir, "..");
/** Studio's own data folder: ./data in a checkout, ~/.crew-studio/data for the binary. */
export const DEFAULT_DATA = COMPILED ? join(homedir(), ".crew-studio", "data") : join(SRC_ROOT, "data");
/** argv that runs one of Studio's helpers (an MCP stdio server) with the same runtime. */
/** What Studio's own helpers (the MCP tool server) read inside a sandboxed round: the binary, or the source folder. */
export function helperReads(): string[] { return COMPILED ? [process.execPath] : [join(SRC_ROOT, "src"), join(SRC_ROOT, "package.json")]; }
export function helperCommand(name: "mcp" | "permission-mcp" | "check-script", args: string[] = []): string[] {
  return COMPILED ? [process.execPath, name, ...args] : [process.execPath, join(SRC_ROOT, "src", `${name}.ts`), ...args];
}
