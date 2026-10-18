// A stand-in CLI that records its own argv and environment (what KERN_PROCARGS2 would expose to any same-uid process) to
// the file named by CREW_ARGV_REC, then exits like a finished agent turn. Used by tests/sandbox-token-theft.ts to prove the
// providers put no tool token on the CLI's argv or in its env.
import { writeFileSync } from "node:fs";
try { writeFileSync(process.env.CREW_ARGV_REC, JSON.stringify({ argv: process.argv.slice(2), env: process.env })); } catch {}
// a minimal stream-json "result" so the claude parser ends the turn without error; codex ignores unknown lines
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }) + "\n");
