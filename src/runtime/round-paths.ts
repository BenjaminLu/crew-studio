// Where an agent round may open (architecture §10): one rule, shared by the runtime's
// refusal in Agents (src/agent.ts) and the conformance test (tests/round-paths.ts).
// A round's own folders are what the runtime materialized for it: a task worktree or a
// scratch folder under <data>/work, or a folder outside Studio's data and every
// protected root. Never Studio's own data (data/runs, cards, credentials, ...).
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { realInside } from "../secure";

export type RoundSandboxSpec = { writes: string[]; reads?: string[]; cwd?: string; allow?: string[] };

/** The first path of a round's sandbox spec that the round may not reach, or null when every path is allowed. */
export function roundPathRefusal(dataDir: string, protect: string[], sb: RoundSandboxSpec): string | null {
  const work = join(dataDir, "work");
  const paths = [...sb.writes, ...(sb.reads ?? []), ...(sb.cwd ? [sb.cwd] : [])];
  return paths.find((p) => typeof p !== "string" || !p
    || protect.some((r) => realInside(r, p, true) || realInside(p, r, true))
    || (realInside(dataDir, p, true) && !realInside(work, p))
    || realInside(p, dataDir, true)) ?? null;
}

const part = (s: string) => { const v = String(s); if (!v || v === "." || v === ".." || /[\\/\0]/.test(v)) throw new Error(`invalid round folder part ${JSON.stringify(v)}`); return v; };

/** The path of a round's working folder: <data>/work/<area>/<run>/<leaf>. */
export function roundWorkPath(dataDir: string, ...parts: string[]): string {
  const work = resolve(dataDir, "work"), p = join(work, ...parts.map(part));
  if (!p.startsWith(work + sep)) throw new Error(`a round folder lives under ${work}`);
  return p;
}

/** Materialize a round's working folder under <data>/work (fresh: emptied first). */
export function materializeRoundDir(dataDir: string, parts: string[], o: { fresh?: boolean } = {}): string {
  const p = roundWorkPath(dataDir, ...parts);
  if (o.fresh ?? true) rmSync(p, { recursive: true, force: true });
  mkdirSync(p, { recursive: true });
  return p;
}
