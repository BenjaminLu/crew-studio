// The stub acceptance suite in the sandboxed profile: what a new captain's Mac runs by default.
//   bun scripts/acceptance-sandboxed.ts            (ACCEPTANCE_ONLY=<workflow|workflow:run>[,…] narrows it)
//   bun scripts/acceptance-sandboxed.ts --e2e      (bun run test:sandboxed-e2e: the pre-deploy gate, see below)
// Every Studio it starts has the OS sandbox and egress proxy on (CREW_LOCAL_UNRESTRICTED is never set), an empty HOME,
// no tool cache (no Playwright browsers, no PLAYWRIGHT_MODULE / NODE_PATH, no stand-in renderer) and the stub vendor
// CLIs. A run whose workflow needs an install this Mac lacks is SKIPPED with the install named, never passed, and the
// summary lists which workflow needs which install (scripts/acceptance/installs.ts, read from each definition).
//
// --e2e: the same sandbox, empty HOME and stripped environment, but with this Mac's installed tools as the live board has
// them: the account's Playwright browser cache (read by Studio's own renderer only; rounds never reach it), ffmpeg and node
// on PATH, and no stand-in renderer, so every capture, PDF, interaction smoke and film render is real. Every bundled
// workflow must reach its terminal state: a run that cannot run with the sandbox on FAILS (never skips).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountHome } from "../src/render";

const e2e = process.argv.includes("--e2e");
const home = mkdtempSync(join(tmpdir(), "crew-acceptance-sandboxed-home-"));
const env: Record<string, string> = { ...(process.env as Record<string, string>), ACCEPTANCE_PROFILE: e2e ? "sandboxed-e2e" : "sandboxed", HOME: home, PLAYWRIGHT_BROWSERS_PATH: join(home, "no-browsers") };
for (const k of ["CREW_LOCAL_UNRESTRICTED", "CREW_LOCAL_DEPENDENCY_ROOT", "PLAYWRIGHT_MODULE", "CREW_PLAYWRIGHT_MODULE", "NODE_PATH", "CREW_RENDER_STUB", "CREW_RENDER_STUB_MP4", "CREW_E2E_BROWSERS"]) delete env[k];
if (e2e) {
  // Playwright's documented default cache (what the live Studio's renderer reads); an explicit PLAYWRIGHT_BROWSERS_PATH wins
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || join(accountHome(), "Library", "Caches", "ms-playwright");
  if (!existsSync(browsers)) { console.log(`FAIL            sandboxed e2e needs Playwright's Chromium (${browsers} is missing): npx playwright install chromium`); process.exit(1); }
  env.CREW_E2E_BROWSERS = browsers;
}
const p = Bun.spawn(["bun", join(import.meta.dir, "../tests/acceptance.ts")], { env, stdout: "inherit", stderr: "inherit" });
const code = await p.exited;
rmSync(home, { recursive: true, force: true });
process.exit(code);
