// Studio's own verification of one staffed model before a start or a review room turn (src/runtime/index.ts autoVerify;
// docs/architecture.md, "Adaptive staffing"): a signed-in Claude pair gets #44's one bounded request (admitSignedInClaude, a
// receipt that serves half an hour); a Cursor key is checked again (`cursor-agent models`, no model request); Codex reads its
// free probe again. It only says whether the verification ran and passed: the caller reads the facts again and decides.
import { ClaudeNative, nativeClaude, admitSignedInClaude, isClaudeExecutionAdmission, validClaudePair } from "./claude-native";
import { verifyCursor } from "./cursor";
import { probeCodex } from "./codex-probe";

export type StaffingVerify = (role: { provider: string; model: string; effort: string | null }, o?: { signal?: AbortSignal }) => Promise<boolean>;
export function makeStaffingVerify(d: { claude?: ClaudeNative; cursor?: typeof verifyCursor; codex?: typeof probeCodex } = {}): StaffingVerify {
  const claude = d.claude ?? nativeClaude, cursor = d.cursor ?? verifyCursor, codex = d.codex ?? probeCodex;
  return async (role, o) => {
    const signal = o?.signal; if (signal?.aborted) return false;
    if (role.provider === "claude") { const pair = { model: role.model, effort: role.effort }; if (!validClaudePair(pair)) return false;
      const cap = await claude.status(pair, signal);
      return isClaudeExecutionAdmission(await admitSignedInClaude(cap, pair, { verify: (p, x) => claude.verify(p, x), admitted: isClaudeExecutionAdmission }, signal), pair); }
    if (role.provider === "cursor") return !!(await cursor({ fresh: true, signal }))?.ok;
    if (role.provider === "codex") return (await codex(undefined, signal)).auth === "verified";
    return false;
  };
}
export const staffingVerify = makeStaffingVerify();
