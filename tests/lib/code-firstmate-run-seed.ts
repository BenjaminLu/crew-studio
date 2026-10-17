// Seeds one real code-firstmate Task into a Studio data folder before the server starts:
// the real pack workflow, the real code domain and skill library, a registered local
// repository, the stub provider. The Task runs until its Spec agent starts (the step
// records its pinned skills), then the captain cancels it, so the server loads a
// finished Task with real node states and steps.
// Why: since a6fd64f a code-firstmate Task started through the server needs a signed
// captain staffing approval (src/domain/staffing.ts) that names a real provider, so a
// page test can no longer start one with the stub provider.
//   bun tests/lib/code-firstmate-run-seed.ts <data dir> [intent]   → prints {"id": ...}
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, until } from "../rt-harness";
import { bundledText } from "../../src/bundled";

export async function seedCodeFirstmateRun(data: string, text = "Add a percent function to money-kit") {
  const root = join(import.meta.dir, "..", "..");
  mkdirSync(data, { recursive: true });
  const repo = mkdtempSync(join(tmpdir(), "crew-seed-repo-"));
  for (const a of [["init", "-b", "main"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "init"]])
    if (Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe" }).exitCode) throw new Error("fixture repository setup failed");
  const registry = join(data, "projects.json"); const projects = existsSync(registry) ? JSON.parse(readFileSync(registry, "utf8")) : [];
  if (!projects.some((p: any) => p.id === "seed")) writeFileSync(registry, JSON.stringify([...projects, { id: "seed", name: "Seed fixture", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
  const { Skills } = await import("../../src/skills"); const { installCode } = await import("../../src/domain/code"); const { Projects } = await import("../../src/doors");
  const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data, checkRoots: [] });
  try {
    const lib = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
    (H.engine.deps as any).library = lib; (H.defs as any).skillInfo = (id: string, v: number) => lib.pinInfo(id, v);
    (H.engine.deps as any).skillText = (ref: string) => bundledText("packs/" + ref.slice(5)) ?? "";
    installCode(H.engine, { dataDir: data, projects: new Projects(data) });
    const r = H.engine.start({ workflow: "code-firstmate", text, params: { project: "seed" } } as any);
    const waiting = () => H.engine.get(r.id)!.nodes.dispatch?.waiting === "card";
    await until(() => waiting() || ["failed", "succeeded", "cancelled"].includes(H.engine.get(r.id)!.status), 60000);
    const run = H.engine.get(r.id)!;
    if (!waiting()) throw new Error(`the seeded Task did not reach its dispatch card: ${run.status} ${run.error ?? ""} ${JSON.stringify(Object.fromEntries(Object.entries(run.nodes).filter(([, n]: any) => n.state !== "pending").map(([k, n]: any) => [k, n.state])))}`);
    await until(() => !H.engine.busy(r.id), 30000);
    return { id: r.id };
  } finally { H.stop(); }
}
if (import.meta.main) { const out = await seedCodeFirstmateRun(process.argv[2], process.argv[3]); console.log(JSON.stringify(out)); process.exit(0); }
