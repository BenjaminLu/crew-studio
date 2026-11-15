import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Studio's own verification of one staffed model (src/providers/staffing-verify.ts), through the real CLI path: an offline
// installed-Claude stand-in (tests/fixture/claude-native.mjs) answers auth status and the one bounded request. A passed
// verification is a receipt the next call reuses (no second request); a refused one does not pass; one that is not signed in
// pays for nothing. Cursor's check gets the caller's signal; Codex reads its probe. No model is called.
//   bun tests/staffing-verify.ts
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ClaudeNative } from "../src/providers/claude-native";
import { makeStaffingVerify } from "../src/providers/staffing-verify";
import { suite } from "./rt-harness";
const { ok, end } = suite("staffing-verify");
const root = mkdtempSync("/private/tmp/crew-staffing-verify-"), fixture = join(import.meta.dirname, "fixture/claude-native.mjs");
const rows = () => { try { return readFileSync(join(root, "trace.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s)); } catch { return []; } };
const requests = (mode: string) => rows().filter((r) => r.mode === mode && r.phase === "model").length;
const claudeAt = (mode: string) => { const bin = join(root, mode + ".mjs"); copyFileSync(fixture, bin);
  return new ClaudeNative({ bin, login: () => ({ ok: true, env: {}, source: "offline fixture only (own account)", warn: null, kind: "account" }) } as any); };
const role = { provider: "claude", model: "claude-sonnet-5-5", effort: "low" };
try {
  { const verify = makeStaffingVerify({ claude: claudeAt("success") });
    ok(await verify(role) === true && requests("success") === 1, "a signed-in Claude pair is verified with one bounded request through the CLI", JSON.stringify(rows().slice(-3)));
    ok(await verify(role) === true && requests("success") === 1, "a second verification within the receipt's window makes no new request"); }
  { const verify = makeStaffingVerify({ claude: claudeAt("mismatch") });
    ok(await verify(role) === false && requests("mismatch") === 1, "a request answered by another model does not pass"); }
  { const verify = makeStaffingVerify({ claude: claudeAt("missing") });
    ok(await verify(role) === false && requests("missing") === 0, "a Claude that is not signed in is never sent a request"); }
  { const verify = makeStaffingVerify({ claude: claudeAt("success") });
    ok(await verify({ ...role, model: "not-a-claude-model" }) === false, "a model that is not a Claude model is never verified"); }
  { const ac = new AbortController(); ac.abort(); const verify = makeStaffingVerify({ claude: claudeAt("success") });
    ok(await verify({ ...role, effort: "high" }, { signal: ac.signal }) === false && requests("success") === 1, "an ended caller pays for nothing"); }
  { let seen: any = null; const verify = makeStaffingVerify({ cursor: (async (o: any) => { seen = o; return { ok: true } as any; }) as any, codex: (async (_b: any, signal: any) => ({ auth: signal ? "verified" : "unverified" })) as any });
    const ac = new AbortController();
    ok(await verify({ provider: "cursor", model: "composer", effort: null }, { signal: ac.signal }) === true && seen?.fresh === true && seen.signal === ac.signal, "Cursor's key is checked again with the caller's signal");
    ok(await verify({ provider: "codex", model: "gpt-x", effort: "low" }, { signal: ac.signal }) === true, "Codex reads its free probe again, with the signal");
    ok(await verify({ provider: "stub", model: "x", effort: null }) === false, "an unknown vendor is never verified"); }
} finally { rmSync(root, { recursive: true, force: true }); }
end();
