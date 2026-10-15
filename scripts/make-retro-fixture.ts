// tests/fixture/retro/events.jsonl: the events the code retro's classes and
// metrics read, cut from the live firstmate log (read-only) and trimmed to the
// fields the retro uses. Owner and repository names are replaced.   bun scripts/make-retro-fixture.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RawLog } from "../src/rawlog";
import { detect } from "../src/retro";
const cfg = (Bun as any).YAML.parse(await Bun.file(join(import.meta.dir, "../workflows/code.retro.yaml")).text());
const log = new RawLog(process.env.CREW_FM_STATE ? join(process.env.CREW_FM_STATE, "events.jsonl") : join(homedir(), "Desktop/firstmate-workflow/state/events.jsonl"));
const evs = log.poll();
const from = new Date(Date.now() - 14 * 86400e3).toISOString();
const win = evs.filter((e) => e.ts >= from);
const keep = new Set<number>();
for (const d of cfg.classes) for (const h of detect(d, win)) keep.add(h.seq);
const counted = new Set(["merged", "dispatched", "review_failed", "gate_failed", "worker_crashed", "agent_lost"]);
for (const e of win) if (counted.has(e.type) || (e.type === "autopilot_waiting" && /CI failed/.test(e.summary?.en ?? ""))) keep.add(e.seq);
for (const e of win) if (e.data?.evidence_event === "brief_round_finished") keep.add(e.seq);
const scrub = (s: string) => s.replace(new RegExp(process.env.CREW_SCRUB_NAMES ?? "(?!)", "gi"), "captain");
const out = win.filter((e) => keep.has(e.seq)).map((e) => {
  const data: any = {};
  if (e.data?.coverage?.gaps) data.coverage = { situation: e.data.coverage.situation, gaps: e.data.coverage.gaps.filter((g: string) => /1200 lines|missing authorized local brief|shard/.test(g)) };
  if (typeof e.data?.duration === "number") data.duration = e.data.duration;
  if (e.data?.evidence_event) data.evidence_event = e.data.evidence_event;
  return scrub(JSON.stringify({ ts: e.ts, actor: e.actor, type: e.type, task: e.task, pr: e.pr ?? undefined, summary: { en: e.summary?.en ?? "" }, data }));
});
mkdirSync(join(import.meta.dir, "../tests/fixture/retro"), { recursive: true });
writeFileSync(join(import.meta.dir, "../tests/fixture/retro/events.jsonl"), out.join("\n") + "\n");
console.log(`retro fixture: ${out.length} events (${from} → now)`);
