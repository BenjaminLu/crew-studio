// Writes the files made from src/observe/ (the server instructions' rules, the tool index, the registry's kinds and the read
// tools' specs): skills/firstmate/SKILL.md (src/observe/guide.ts), and the plug-in kit's studio skill and tools reference page
// (src/observe/kit.ts). tests/observe-index.ts fails while a file differs from what this writes.
//   bun scripts/observe-index.ts            print the firstmate skill
//   bun scripts/observe-index.ts --write    write every file
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { firstmateSkill } from "../src/observe/guide";
import { studioSkill, toolsReference } from "../src/observe/kit";

const ROOT = join(import.meta.dir, "..");
export const SKILL_PATH = join(ROOT, "skills", "firstmate", "SKILL.md");
export const GENERATED: { path: string; text: () => string }[] = [
  { path: SKILL_PATH, text: firstmateSkill },
  { path: join(ROOT, "plugins", "crew-studio", "skills", "studio", "SKILL.md"), text: studioSkill },
  { path: join(ROOT, "docs", "reference", "studio-tools.md"), text: toolsReference },
];
if (import.meta.main) {
  if (process.argv.includes("--write")) for (const g of GENERATED) { mkdirSync(dirname(g.path), { recursive: true }); writeFileSync(g.path, g.text()); console.log(`wrote ${g.path}`); }
  else process.stdout.write(firstmateSkill());
}
