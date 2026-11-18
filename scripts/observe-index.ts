// Writes skills/firstmate/SKILL.md from its one source (src/observe/guide.ts: the server instructions' rules, the tool index and
// the registry's kinds). tests/observe-index.ts fails while the file differs from what this writes.
//   bun scripts/observe-index.ts            print it
//   bun scripts/observe-index.ts --write    write skills/firstmate/SKILL.md
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { firstmateSkill } from "../src/observe/guide";

export const SKILL_PATH = join(import.meta.dir, "..", "skills", "firstmate", "SKILL.md");
if (import.meta.main) {
  const text = firstmateSkill();
  if (process.argv.includes("--write")) { mkdirSync(dirname(SKILL_PATH), { recursive: true }); writeFileSync(SKILL_PATH, text); console.log(`wrote ${SKILL_PATH}`); }
  else process.stdout.write(text);
}
