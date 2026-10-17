import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Example workflows (the startup competition, src/runtime/defs.ts EXAMPLE_DEFAULTS): a fresh install neither seeds
// them nor tells Firstmate about them; CREW_EXAMPLE_WORKFLOWS=1 seeds them; an install that has one keeps it,
// gets built-in updates of it while the captain has not edited it, and keeps an edited copy as it is.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowDefs } from "../src/runtime/defs";
import { createRuntime } from "../src/runtime";
import { Agents } from "../src/agent";
import { StudioLog } from "../src/rawlog";

let pass = 0, fail = 0;
const ok = (v: unknown, n: string, d = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${n}${v ? "" : " " + d}`); v ? pass++ : fail++; };
const root = mkdtempSync(join(tmpdir(), "example-workflows-"));
const withExamples = <T>(on: boolean, f: () => T): T => { const prev = process.env.CREW_EXAMPLE_WORKFLOWS; if (on) process.env.CREW_EXAMPLE_WORKFLOWS = "1"; else delete process.env.CREW_EXAMPLE_WORKFLOWS;
  try { return f(); } finally { if (prev === undefined) delete process.env.CREW_EXAMPLE_WORKFLOWS; else process.env.CREW_EXAMPLE_WORKFLOWS = prev; } };
const runtime = (dir: string) => createRuntime({ dataDir: dir, agents: new Agents(dir, () => ""), provider: () => { throw new Error("no provider"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(dir, "events")), send() {}, fmRoot: join(root, "fm") } as any);
const owner = { key: "examples-fixture", captain: true, text: "Captain fixture brief", live: () => true };
try {
  // Firstmate: no startup tool or prompt text where the example is not installed
  const fresh = withExamples(false, () => runtime(join(root, "fresh")));
  const specs = fresh.firstmate.specs as any[];
  ok(!fresh.defs.get("startup-recursion"), "a fresh install has no startup competition");
  ok(!specs.some((s) => s.name === "studio_startup_workflow_contract") && !specs.some((s) => /startup-recursion|studio_startup_workflow_contract/.test(String(s.description))), "Firstmate gets no startup tool and no startup text on a fresh install", JSON.stringify(specs.find((s) => s.name === "studio_propose_work")?.description).slice(0, 300));
  ok(specs.some((s) => s.name === "studio_propose_work" && /coffee-kit/.test(s.description)), "the rest of the propose tool's guidance stays");
  let refused: any = null; try { await fresh.firstmate.call("studio_startup_workflow_contract", {}, owner); } catch (e) { refused = e; } ok(refused?.publicFailure?.code === "unknown_tool", "calling the startup tool anyway is refused", String(refused));
  const seeded = withExamples(true, () => runtime(join(root, "seeded")));
  const s2 = seeded.firstmate.specs as any[];
  ok(seeded.defs.get("startup-recursion") && s2.some((s) => s.name === "studio_startup_workflow_contract") && s2.some((s) => s.name === "studio_propose_work" && /startup-recursion/.test(s.description)), "with the example installed, Firstmate gets its tool and guidance");
  // built-in updates reach an unedited installed example, never an edited one
  const dir = join(root, "update"); withExamples(true, () => new WorkflowDefs(dir));
  const v1 = join(dir, "workflows", "startup-recursion", "v1.json"); const d1 = JSON.parse(readFileSync(v1, "utf8")); writeFileSync(v1, JSON.stringify({ ...d1, seed: "0000000000000000" })); // as if seeded from an older built-in
  const later = withExamples(false, () => new WorkflowDefs(dir));
  ok(later.get("startup-recursion")?.version === 2 && later.get("startup-recursion")?.by === "studio (built-in update)", "an installed, unedited example gets the changed built-in as a new version, flag or not", JSON.stringify(later.get("startup-recursion")?.by));
  const edited = join(root, "edited"); const e0 = withExamples(true, () => new WorkflowDefs(edited)); const cur = e0.get("startup-recursion")!;
  e0.save("startup-recursion", { ...cur, base: cur.version, description: "Captain's own competition" } as any, "captain");
  const ev = join(edited, "workflows", "startup-recursion", "v1.json"); writeFileSync(ev, JSON.stringify({ ...JSON.parse(readFileSync(ev, "utf8")), seed: "0000000000000000" }));
  const e1 = withExamples(false, () => new WorkflowDefs(edited));
  ok(e1.get("startup-recursion")?.version === 2 && e1.get("startup-recursion")?.description === "Captain's own competition", "a captain-edited example is kept as it is");
} catch (e: any) { fail++; console.log("  FAIL  exception", e?.stack ?? e); }
finally { rmSync(root, { recursive: true, force: true }); }
console.log(`example-workflows: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
