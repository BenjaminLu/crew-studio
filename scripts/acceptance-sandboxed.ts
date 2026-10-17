// The stub acceptance suite in the sandboxed profile: what a new captain's Mac runs by default.
//   bun scripts/acceptance-sandboxed.ts            (ACCEPTANCE_ONLY=<workflow|workflow:run>[,…] narrows it)
// Every Studio it starts has the OS sandbox and egress proxy on (CREW_LOCAL_UNRESTRICTED is never set), an empty HOME,
// no tool cache (no Playwright browsers, no PLAYWRIGHT_MODULE / NODE_PATH, no stand-in renderer) and the stub vendor
// CLIs. A run whose workflow needs an install this Mac lacks is SKIPPED with the install named, never passed, and the
// summary lists which workflow needs which install (scripts/acceptance/installs.ts, read from each definition).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "crew-acceptance-sandboxed-home-"));
const env: Record<string, string> = { ...(process.env as Record<string, string>), ACCEPTANCE_PROFILE: "sandboxed", HOME: home, PLAYWRIGHT_BROWSERS_PATH: join(home, "no-browsers") };
for (const k of ["CREW_LOCAL_UNRESTRICTED", "CREW_LOCAL_DEPENDENCY_ROOT", "PLAYWRIGHT_MODULE", "CREW_PLAYWRIGHT_MODULE", "NODE_PATH", "CREW_RENDER_STUB", "CREW_RENDER_STUB_MP4"]) delete env[k];
const p = Bun.spawn(["bun", join(import.meta.dir, "../tests/acceptance.ts")], { env, stdout: "inherit", stderr: "inherit" });
const code = await p.exited;
rmSync(home, { recursive: true, force: true });
process.exit(code);
