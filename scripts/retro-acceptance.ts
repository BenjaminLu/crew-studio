// Runs the code retro over firstmate's live event log (read-only) for the last
// 14 days and prints the repeat classes it finds. Writes only to a temp folder.
//   bun scripts/retro-acceptance.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { RawLog } from "../src/rawlog";
import { Retros } from "../src/retro";
const cfg = (Bun as any).YAML.parse(readFileSync(join(import.meta.dir, "../workflows/code.retro.yaml"), "utf8"));
const file = join(process.env.CREW_FM_STATE ?? join(homedir(), "Desktop/firstmate-workflow/state"), "events.jsonl");
const log = new RawLog(file);
const r = new Retros(mkdtempSync(join(tmpdir(), "crew-retro-acc-"))).run(cfg, log.poll(), { trigger: "acceptance", days: 14 });
console.log(`window ${r.window.from.slice(0, 10)} → ${r.window.to.slice(0, 10)}, ${r.window.events} events`);
for (const c of r.classes) console.log(`${c.found ? "FOUND    " : "NOT FOUND"} ${c.title}: ${c.count} hits on ${c.groups.length} ${c.groups.slice(0, 8).join(", ")}${c.note ? ` (${c.note})` : ""}`);
