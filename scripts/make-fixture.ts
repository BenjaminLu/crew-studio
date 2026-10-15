// Builds tests/fixture/state: a small, secret-free slice of a live firstmate
// state directory for the smoke tests. It reads the live state and never
// writes to it. Keys, evidence, environments and decision answers are not copied.
//   bun scripts/make-fixture.ts [source-state-dir]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SRC = process.argv[2] ?? join(homedir(), "Desktop/firstmate-workflow/state");
const OUT = join(import.meta.dir, "../tests/fixture/state");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "pending"), { recursive: true });

// the last 1500 events
const lines = readFileSync(join(SRC, "events.jsonl"), "utf8").trimEnd().split("\n");
const events = lines.slice(-1500);
writeFileSync(join(OUT, "events.jsonl"), events.join("\n") + "\n");
const tasks = new Set<string>();
for (const l of events) { try { const t = JSON.parse(l).task; if (/^T-\d+$/.test(t)) tasks.add(t); } catch {} }

// each task's latest pin, cut down to what Crew Studio reads
for (const t of tasks) {
  const dir = join(SRC, "pins", t);
  if (!existsSync(dir)) continue;
  const latest = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(b) - parseInt(a))[0];
  if (!latest) continue;
  const pin = JSON.parse(readFileSync(join(dir, latest), "utf8"));
  mkdirSync(join(OUT, "pins", t), { recursive: true });
  writeFileSync(join(OUT, "pins", t, latest), JSON.stringify({ task: t, version: pin.version, door: pin.door ?? null,
    snapshots: { spec: { text: pin.snapshots?.spec?.text ?? "{}" } } }, null, 1));
}

// two answered cards turned back into pending ones: a merge card and a dispatch card;
// a copy of the merge card with a door check stands for a board-only card
const decided = readdirSync(join(SRC, "decisions")).filter(f => f.endsWith(".json"))
  .map(f => ({ f, m: statSync(join(SRC, "decisions", f)).mtimeMs })).sort((a, b) => b.m - a.m).map(x => x.f);
const strip = (o: any) => { for (const k of ["chosen", "answers", "merge", "merge_settled", "effect", "effect_outcome", "effect_reason", "binding", "identity", "ste", "expected_head", "note"]) delete o[k]; return o; };
const pick = (pred: (o: any) => boolean) => {
  for (const f of decided) { const o = JSON.parse(readFileSync(join(SRC, "decisions", f), "utf8")); if (o.details?.en && pred(o)) return strip(o); }
  return null;
};
const merge = pick(o => o.kind === "merge" && !o.details.en.check);
const dispatch = pick(o => o.purpose === "dispatch" || /^Dispatch/.test(o.details.en.title ?? ""));
if (merge) writeFileSync(join(OUT, "pending", `${merge.id}.json`), JSON.stringify(merge, null, 1));
if (dispatch) writeFileSync(join(OUT, "pending", `${dispatch.id}.json`), JSON.stringify(dispatch, null, 1));
if (merge) {
  const check = { ...merge, id: "D-fixture-door-check", details: { ...merge.details, en: { ...merge.details.en, check: { why: "Review each intent first." } } } };
  writeFileSync(join(OUT, "pending", "D-fixture-door-check.json"), JSON.stringify(check, null, 1));
}

// the two most recent crew rounds: identity, a placeholder pid, and the tail of their log
const runs = readdirSync(join(SRC, "runs")).map(d => ({ d, m: statSync(join(SRC, "runs", d)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 2);
for (const { d } of runs) {
  const base = join(SRC, "runs", d), out = join(OUT, "runs", d);
  mkdirSync(out, { recursive: true });
  const id = JSON.parse(readFileSync(join(base, "identity.json"), "utf8"));
  writeFileSync(join(out, "identity.json"), JSON.stringify({ actor: id.actor, role: id.role, task: id.task, name: id.name, project: id.project,
    round: id.round, attempt: id.attempt, created: id.created, vendor: id.vendor, model_requested: id.model_requested }, null, 1));
  writeFileSync(join(out, "process.json"), JSON.stringify({ actor: id.actor, pid: 0 }));
  const vendor = readdirSync(base).filter(n => existsSync(join(base, n, "cli.log")))
    .sort((a, b) => statSync(join(base, b, "cli.log")).mtimeMs - statSync(join(base, a, "cli.log")).mtimeMs)[0];
  if (vendor) {
    mkdirSync(join(out, vendor), { recursive: true });
    const log = readFileSync(join(base, vendor, "cli.log"), "utf8").trimEnd().split("\n").slice(-150).join("\n") + "\n";
    writeFileSync(join(out, vendor, "cli.log"), log);
  }
}
console.log(`fixture: ${events.length} events, ${tasks.size} tasks, ${readdirSync(join(OUT, "pending")).length} pending, ${runs.length} runs -> ${OUT}`);
