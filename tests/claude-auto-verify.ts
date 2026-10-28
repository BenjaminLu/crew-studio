import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A signed-in Claude with no execution receipt is verified by Studio itself before a round (src/providers/claude-native.ts
// admitSignedInClaude): the captain never has to press Verify in Doctor first. Nothing else is verified automatically:
// not a Claude that is not signed in, not one whose quota is exhausted, not one already admitted. No model is called.
//   bun tests/claude-auto-verify.ts
import assert from "node:assert/strict";
const { admitSignedInClaude } = await import("../src/providers/claude-native");
let pass = 0; const ok = (v: unknown, n: string) => { assert.ok(v, n); pass++; console.log("ok " + n); };
const pair = { model: "claude-opus-5-5", effort: null };
const cap = (o: any = {}) => ({ provider: "claude", available: true, auth: "verified", quota: "unknown", models: [], at: 0, expires: 0, ...o }) as any;
const admittedCap = cap({ models: [{ id: pair.model }], admission: "verified-execution" });
const fakes = (admitted = false) => { const calls: any[] = []; return { calls, deps: { verify: async (p: any, o: any) => { calls.push([p, o.confirm]); return admittedCap; }, admitted: (c: any) => admitted || c === admittedCap } }; };
{ const f = fakes(); const out = await admitSignedInClaude(cap(), pair, f.deps); ok(out === admittedCap && f.calls.length === 1 && f.calls[0][1] === true && f.calls[0][0].model === pair.model, "a signed-in Claude with no receipt is verified once, for the exact model and effort, and the verified capability is used"); }
{ const f = fakes(true), c = cap(); ok(await admitSignedInClaude(c, pair, f.deps) === c && f.calls.length === 0, "an already admitted Claude is used as it is, with no extra request"); }
for (const [o, name] of [[{ auth: "missing" }, "not signed in"], [{ auth: "unverified" }, "login unverified"], [{ quota: "exhausted", refusal: "exhausted" }, "quota exhausted"], [{ available: false }, "unavailable"], [{ provider: "codex" }, "another provider"]] as const) {
  const f = fakes(), c = cap(o); ok(await admitSignedInClaude(c, pair, f.deps) === c && f.calls.length === 0, `${name}: nothing is verified automatically`); }
{ const f = fakes(); ok(await admitSignedInClaude(cap(), { model: "not-a-claude-model", effort: null }, f.deps) && f.calls.length === 0, "an unsupported model or effort is never verified"); }
console.log(`claude-auto-verify: ${pass} passed, 0 failed`);
