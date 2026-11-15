import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A real Claude round on the captain's own sign-in, end to end the way Studio runs one: the native receipt (one bounded
// verification), makeNativeClaudeProvider, Agents.run under the OS sandbox with the round profile (exec allowlist, keychain
// link, no worktree), the egress proxy, the Studio MCP relay and the init/tool lock. A shell launcher named claude sits first
// on PATH, as a terminal app's wrapper does (it skips its own folder, found with dirname, and execs the next claude): the
// round must run the CLI itself and answer, never hang.
// It makes two tiny paid model calls and reads the captain's own Claude sign-in (the CLI does, never Studio), so it runs only
// when asked, on a Mac with a signed-in claude CLI, and never in CI:
//   CREW_REAL_CLAUDE_ROUND=1 bun tests/claude-real-round.ts      (CREW_REAL_CLAUDE_MODEL picks the model; default the small one)
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.CREW_REAL_CLAUDE_ROUND !== "1" || process.env.CI) { console.log("claude-real-round: skipped (set CREW_REAL_CLAUDE_ROUND=1 to run a real, paid Claude round)"); process.exit(0); }
if (process.platform !== "darwin") { console.log("claude-real-round: skipped (the own-account round runs on macOS)"); process.exit(0); }
// isolated-env puts a sentinel claude first on PATH and points CREW_CLAUDE_BIN nowhere: the real one is looked up past them
const realPath = (process.env.PATH ?? "").split(":").filter((d) => d && !/crew-test-cli-sentinel-/.test(d));
if (!realPath.some((d) => existsSync(join(d, "claude")))) { console.log("claude-real-round: skipped (no claude CLI installed)"); process.exit(0); }
for (const k of ["CREW_CLAUDE_BIN", "CREW_CLAUDE_BILLING", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CLAUDECODE"]) delete process.env[k];
const { sandboxInfo } = await import("../src/runtime/checks");
if (!sandboxInfo().ok) { console.log("claude-real-round: skipped (no OS sandbox on this computer)"); process.exit(0); }

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "crew-claude-real-"))), launch = join(TMP, "launch"), data = join(TMP, "data");
mkdirSync(launch); mkdirSync(data);
writeFileSync(join(launch, "claude"), `#!/usr/bin/env bash\nself="$(cd "$(dirname "$0")" && pwd)"\nIFS=:\nfor d in $PATH; do [[ "$d" == "$self" ]] && continue; [[ -x "$d/claude" ]] && exec "$d/claude" "$@"; done\nexit 127\n`, { mode: 0o755 });
process.env.PATH = [launch, ...realPath].join(":");
const { ClaudeNative, makeNativeClaudeProvider } = await import("../src/providers/claude-native");
const { Agents } = await import("../src/agent");
const { Egress } = await import("../src/egress");
const egress = new Egress(join(data, "egress.log")); await egress.start();
const main = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("studio") });
const agents = new Agents(data, () => `http://127.0.0.1:${main.port}`);
const tools = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => { const u = new URL(req.url), t = req.headers.get("x-crew-tool-token") ?? "";
  if (!u.pathname.startsWith("/api/tools")) return new Response("no", { status: 404 }); if (!agents.hasToken(t)) return new Response("no", { status: 401 });
  return Response.json(u.pathname === "/api/tools" ? agents.toolList(t) : await agents.callTool(t, u.pathname.slice(11), await req.json().catch(() => ({})))); } });
agents.egress = egress; agents.toolUrl = () => `http://127.0.0.1:${tools.port}`;
try {
  const native = new ClaudeNative(), binary = native.currentBinary();
  ok(!!binary && !binary.startsWith(launch), "the receipt pins the CLI itself, never the shell launcher first on PATH", binary);
  const pair = { model: process.env.CREW_REAL_CLAUDE_MODEL ?? "claude-haiku-5-5", effort: null };
  const cap = await native.verify(pair, { confirm: true, ttlMs: 60_000 });
  ok(cap.admission === "verified-execution", "the bounded verification admits the model", String(cap.reason));
  if (cap.admission === "verified-execution") {
    const t0 = Date.now();
    const job = await agents.run({ kind: "t", title: "real round", system: "Answer briefly.", text: "Reply with the word ok and nothing else.", provider: makeNativeClaudeProvider(cap, pair), timeoutMs: 120_000,
      tools: [{ name: "note", description: "does nothing", schema: { type: "object", properties: {} }, run: async () => ({ ok: true }) }], sandbox: { writes: [] } });
    ok(job.status === "done" && /ok/i.test(job.said) && Date.now() - t0 < 90_000, "a real round on the captain's own sign-in answers under the round sandbox, through the proxy and the Studio MCP relay", JSON.stringify([job.status, job.errorCode, job.error, Date.now() - t0]));
  }
} finally { egress.stop(); main.stop(true); tools.stop(true); rmSync(TMP, { recursive: true, force: true }); }
console.log(`claude-real-round: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
