// A CLI Studio starts never updates itself. The Claude CLI's npm-global auto-update, run from a child Studio started (an
// auth probe in the captain's own HOME), replaced the installed CLI under every other Claude session on the Mac, and they
// all exited. Every process Studio starts for a vendor CLI gets its environment through cliEnv: the spawn layers
// (probeProcess, spawnJsonl, processSession) apply it themselves, so a new call site cannot leave it out.
export const NO_SELF_UPDATE: Readonly<Record<string, string>> = Object.freeze({ DISABLE_AUTOUPDATER: "1" });
export function cliEnv<T extends Record<string, string | undefined>>(env: T): T & { DISABLE_AUTOUPDATER: string } {
  return { ...env, ...NO_SELF_UPDATE } as T & { DISABLE_AUTOUPDATER: string };
}
