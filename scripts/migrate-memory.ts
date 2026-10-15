// Plan (dry run only) for moving firstmate's memory out of Claude's folder into
// the vendor-neutral memory folder Crew Studio reads. It reads, never writes.
//   bun scripts/migrate-memory.ts --dry-run [--from <claude memory dir>] [--to <neutral dir>]
// Without --dry-run it refuses: the real move happens only at the captain's cutover.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseNote } from "../src/memory";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
if (!process.argv.includes("--dry-run")) { console.error("migrate-memory: only --dry-run is allowed before the captain's cutover"); process.exit(64); }
const from = arg("--from") ?? join(homedir(), ".claude/projects", join(homedir(), "Desktop/firstmate-workflow").replace(/\//g, "-"), "memory");
const to = arg("--to") ?? process.env.CREW_MEMORY_DIR ?? join(import.meta.dir, "../data/memory");
if (!existsSync(from)) { console.log(`nothing to migrate: ${from} does not exist`); process.exit(0); }
const files = readdirSync(from).filter((f) => f.endsWith(".md"));
const notes = files.filter((f) => f !== "MEMORY.md").map((f) => parseNote(f, readFileSync(join(from, f), "utf8")));
const names = new Set(notes.map((n) => n.name));
const index = existsSync(join(from, "MEMORY.md")) ? readFileSync(join(from, "MEMORY.md"), "utf8") : "";
const indexed = new Set([...index.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]));
const dangling = notes.flatMap((n) => n.links.filter((l) => !names.has(l)).map((l) => `${n.file} -> [[${l}]]`));
const unindexed = notes.filter((n) => !indexed.has(n.file)).map((n) => n.file);
const byType = notes.reduce<Record<string, number>>((m, n) => ((m[n.type || "untyped"] = (m[n.type || "untyped"] ?? 0) + 1), m), {});
console.log(`DRY RUN — nothing is written.
from: ${from}
to:   ${to}
notes to copy: ${notes.length}   (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(", ")})
MEMORY.md index lines: ${index.split("\n").filter((l) => l.startsWith("- ")).length}, copied as is (paths are relative, so they keep working)
[[links]]: ${notes.reduce((s, n) => s + n.links.length, 0)} total; they name notes by slug, so they map 1:1
links to notes that do not exist yet (kept; they mark notes worth writing): ${dangling.length}${dangling.length ? "\n  " + dangling.slice(0, 12).join("\n  ") : ""}
notes missing from the index (would be appended): ${unindexed.length}${unindexed.length ? "\n  " + unindexed.slice(0, 12).join("\n  ") : ""}
after the cutover: point AGENTS.md / the host's memory setting at ${to}, keep the Claude folder read-only as a backup for a week.`);
