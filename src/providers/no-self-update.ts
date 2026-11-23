// A CLI Studio starts never updates itself. The Claude CLI's npm-global auto-update, run from a child Studio started (an
// auth probe in the captain's own HOME), replaced the installed CLI under every other Claude session on the Mac, and they
// all exited. Every process Studio starts for a vendor CLI gets its environment through cliEnv: the spawn layers
// (probeProcess, spawnJsonl, processSession) apply it themselves, so a new call site cannot leave it out.
export const NO_SELF_UPDATE: Readonly<Record<string, string>> = Object.freeze({ DISABLE_AUTOUPDATER: "1" });
/** cursor-agent has no environment switch: its update runs unless the root command gets --disable-auto-update (a hidden
 *  option of the root program since at least 2026.10.01). Its update installs under $HOME/.local/share/cursor-agent, so the
 *  Cursor Agent terminal, which runs in the captain's own HOME, passes it; rounds, host sessions and probes run with a
 *  private throwaway HOME, where an update could only land in that throwaway folder. Doctor's --version does not: its own
 *  -v, --version option's option:version listener calls process.exit(0) before the root action schedules the update (a
 *  setTimeout), and an older cursor-agent would reject the option. */
export const CURSOR_NO_SELF_UPDATE: readonly string[] = Object.freeze(["--disable-auto-update"]);
export function cliEnv<T extends Record<string, string | undefined>>(env: T): T & { DISABLE_AUTOUPDATER: string } {
  return { ...env, ...NO_SELF_UPDATE } as T & { DISABLE_AUTOUPDATER: string };
}
