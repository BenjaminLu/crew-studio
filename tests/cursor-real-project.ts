import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Firstmate on Cursor in an explicit project with the REAL cursor-agent, when one is installed (skipped otherwise, as in CI):
// two turns under the OS sandbox with a fake key. Each must get as far as Cursor refusing the key, never stop on the sandbox
// first (cursor-agent's --resume needs its shared /tmp/cursor-agent-persist-<uid>, which the sandbox keeps closed: EPERM).
// The key is made up: it reaches Cursor's API only through Studio's proxy and is refused there. Never a real key.
//   bun tests/cursor-real-project.ts        (CREW_REAL_CURSOR_BIN=<path> picks the binary)
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// isolated-env puts a sentinel cursor-agent first on PATH: the real one is looked up past it, by name
const bin = [process.env.CREW_REAL_CURSOR_BIN, ...(process.env.PATH ?? "").split(":").filter((d) => d && !/crew-test-cli-sentinel-/.test(d)).map((d) => join(d, "cursor-agent")), join(homedir(), ".local", "bin", "cursor-agent")]
  .find((f) => !!f && existsSync(f));
if (!bin) { console.log("cursor-real-project: skipped (no cursor-agent installed)"); process.exit(0); }
const { sandboxInfo } = await import("../src/runtime/checks");
if (!sandboxInfo().ok) { console.log("cursor-real-project: skipped (no OS sandbox on this computer)"); process.exit(0); }
const { cursorHost } = await import("../src/host/cursor");

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const FAKE = "crsr_" + "0".repeat(64); // a key's shape Cursor refuses; not a credential
const TMP = mkdtempSync(join(tmpdir(), "crew-cursor-real-")), proj = join(TMP, "project"), data = join(TMP, "data");
for (const d of [proj, data]) mkdirSync(d, { recursive: true });
try {
  const events: any[] = [];
  const s = await cursorHost(bin).attach("", { cwd: proj, fresh: true, cursorProject: true, dataDir: data, env: { CURSOR_API_KEY: FAKE }, model: "composer-2.5", onEvent: (e: any) => events.push(e), onPermission: async () => ({ allow: false }) } as any);
  for (const text of ["hello", "and again"]) {
    const r = await s.send(text);
    const stderr = events.filter((e) => e.type === "exit").map((e) => String(e.stderr ?? "")).join("\n");
    ok(r.status === "failed" && /API key/i.test(r.message ?? "") && /invalid|right key/i.test(`${r.message} ${stderr}`) && !/EPERM|persistent session|cursor-agent-persist|Operation not permitted/.test(`${r.message} ${stderr}`),
      `turn "${text}": the real cursor-agent runs under the OS sandbox and gets as far as Cursor refusing the fake key`, JSON.stringify({ r, stderr: stderr.slice(-400) }));
  }
  ok(!JSON.stringify(events).includes(FAKE), "the key is never in an event");
  await s.detach();
} finally { rmSync(TMP, { recursive: true, force: true }); }
console.log(`cursor-real-project: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
