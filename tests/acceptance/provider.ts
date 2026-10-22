// Which vendor the stub acceptance runs on: ACCEPTANCE_PROVIDER=codex (the default, Codex Firstmate with Claude and Codex
// rounds) or cursor (bun run test:acceptance-cursor). On Cursor the Studio has no Codex or Claude CLI and no login of
// theirs at all: Firstmate, every worker and every reviewer run on tests/fixture/cursor-agent.mjs.
// A workflow that only another vendor can run is BLOCKED-BY-DESIGN on Cursor, with the reason: never a pass, never a silent skip.
export type AcceptanceProvider = "codex" | "cursor";
export const ACCEPTANCE_PROVIDER: AcceptanceProvider = (() => {
  const v = process.env.ACCEPTANCE_PROVIDER || "codex";
  if (v !== "codex" && v !== "cursor") throw new Error(`ACCEPTANCE_PROVIDER must be codex or cursor, not ${v}`);
  return v;
})();
export const ON_CURSOR = ACCEPTANCE_PROVIDER === "cursor";
/** the fixture Cursor key: the official shape, and the prefix tests/fixture/cursor-agent.mjs answers to; not a credential */
export const CURSOR_KEY = "crsr_acceptance" + "0".repeat(49);
export const CURSOR_MODEL = "composer-2.5";

/** The workflows Cursor cannot run, by design, and why (scenario names, and the workflow a run's name starts with). */
export const BLOCKED_ON_CURSOR: Record<string, string> = {
  images: "image generation runs only on Codex's dedicated image app-server (src/providers/codex-image.ts); Cursor has no image tool",
  "coffee-kit": "the coffee kit's photos come from Codex's dedicated image app-server; Cursor has no image tool",
  "startup-recursion": "the startup competition's founder is a verified Claude seat and its judge a Codex seat (providers: [claude, codex]); neither seat runs on Cursor",
};
/** why this scenario or run is blocked on the current vendor (null: it runs) */
export function blockedReason(name: string): string | null {
  if (!ON_CURSOR) return null;
  const base = name.split(":")[0];
  return BLOCKED_ON_CURSOR[name] ?? BLOCKED_ON_CURSOR[base] ?? null;
}
/** the run's provider on the current vendor: every Codex or Claude run is a Cursor run on Cursor */
export const runProvider = (p: string | null | undefined): string | null => (ON_CURSOR && (p === "codex" || p === "claude") ? "cursor" : p ?? null);
/** the run's setup steps on the current vendor: probes reach Cursor's API host, and there is no Claude login to verify */
export const setupSteps = (steps: string[]): string[] => ON_CURSOR ? [...new Set(steps.filter((s) => s !== "verify-claude").map((s) => (s === "probe" || s === "probe-claude" ? "probe-cursor" : s)))] : steps;
/** the staffing answer the harness gives as the captain */
export const STAFFING_ANSWER = ON_CURSOR ? { provider: "cursor", model: CURSOR_MODEL, effort: null } : { provider: "codex", model: "fixture-model", effort: "low" };
