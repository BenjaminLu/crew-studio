// The fixed skeleton every agent brief ends with: BRIEFING, ENVIRONMENT, TOOLS, TESTS, DEPENDENCIES, DELIVERABLE.
// Each section has the round's own facts (from the workflow graph, the mode's environment preflight: test and lint
// command, dependency state, browser and renderer availability, run budget) and then the matching section of the
// operating manual page for the step (manual/<workflow>/<role>.md), with a pointer to it. A section is never empty.
// No operator path reaches a brief: the dependency root, the home folder and Studio's data folder show as placeholders.
import { homedir } from "node:os";
import { manualFor, manualSection } from "../manual";
import { localUnrestricted } from "../local-execution";
import type { WDef, WNode } from "./defs";

export const SKELETON_SECTIONS = ["BRIEFING", "ENVIRONMENT", "TOOLS", "TESTS", "DEPENDENCIES", "DELIVERABLE"] as const;
export type SkeletonKey = (typeof SKELETON_SECTIONS)[number];
/** What a mode adds: facts per section, extra manual pages (a page's section `extra[KEY]` is appended too, e.g. the renderer contract). */
export type SkeletonFacts = Partial<Record<SkeletonKey, string[]>> & { manual?: string[]; extra?: Partial<Record<SkeletonKey, string[]>> };
const TITLE: Record<SkeletonKey, string> = { BRIEFING: "Briefing", ENVIRONMENT: "Environment", TOOLS: "Tools", TESTS: "Tests", DEPENDENCIES: "Dependencies", DELIVERABLE: "Deliverable" };

/** Absolute operator paths as placeholders: the dependency root, Studio's data folder, the home folder. */
export function scrubOperatorPaths(t: string, o: { dataDir?: string | null } = {}): string {
  const subs: [string | undefined | null, string][] = [[process.env.CREW_LOCAL_DEPENDENCY_ROOT, "$CREW_LOCAL_DEPENDENCY_ROOT"], [o.dataDir, "<data>"], [homedir(), "~"]];
  let out = t;
  for (const [from, to] of subs) if (from && from.length > 1) out = out.split(from).join(to);
  return out.replace(/\/(?:Users|home)\/[^/\s"'`]+/g, "~");
}

/** The graph's facts for one agent node: where it sits, what follows it, which checks judge it. */
export function graphFacts(def: WDef, node: WNode, visit: number, modeName: string): { briefing: string[]; checks: string[] } {
  const nodes = def?.nodes ?? [], edges = def?.edges ?? []; // a partial run (a unit test calling a mode directly) still gets its sections
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const out = edges.filter((e) => e.from === node?.id);
  const next = out.map((e) => `${e.when ? `${e.when} → ` : ""}${label(e.to)} (${e.to})`);
  const role = node?.role ?? node?.args?.coordinator ?? node?.args?.role ?? null;
  const checks = new Set<string>();
  for (const c of node?.checks ?? []) checks.add(c.use);
  for (const e of out) { for (const c of e.checks ?? []) checks.add(c.use); const to = nodes.find((n) => n.id === e.to); if (to?.kind === "check") for (const c of to.checks ?? []) checks.add(c.use); }
  return { briefing: [`Workflow ${def?.name ?? "(unknown)"} (${def?.id ?? "?"}) · step ${node?.id ?? "?"} "${node?.label ?? ""}"${role ? ` · role ${role}` : ""} · mode ${modeName} · round ${visit}`,
    ...(node?.detail ? [`Step detail: ${node.detail}`] : []),
    next.length ? `After this step: ${next.join("; ")}` : "This step ends the workflow's path.",
    "A question goes in your result: Firstmate answers it first, the captain only for a one-way decision, a credential or a preference."], checks: [...checks] };
}

/** The six sections, filled: the mode's facts, the generic facts, then the manual page's text and a pointer to it. */
export function composeSkeleton(o: { def: WDef; node: WNode; visit: number; modeName: string; tools: string[]; maxTools?: number | null; timeoutS?: number | null;
  egress?: string[]; facts?: SkeletonFacts | null; dataDir?: string | null }): string {
  const f = o.facts ?? {};
  const g = graphFacts(o.def, o.node, o.visit, o.modeName);
  const role = o.node?.role ?? o.node?.args?.coordinator ?? o.node?.args?.role ?? null;
  const pages = [...new Set([manualFor(o.def?.id ?? "", role, o.modeName === "deliver" ? "studio/deliver" : "studio/agents"), ...(f.manual ?? [])])];
  const unrestricted = (() => { try { return localUnrestricted(); } catch { return false; } })();
  const generic: Record<SkeletonKey, string[]> = {
    BRIEFING: g.briefing,
    ENVIRONMENT: [unrestricted ? "Local unrestricted mode (an operator setting): no OS sandbox and no network limit; dependencies come from $CREW_LOCAL_DEPENDENCY_ROOT." : `Round sandbox: you write only where this step's tools write; network reaches your provider${o.egress?.length ? ` and ${o.egress.join(", ")}` : " only"}.`,
      `Limits: ${o.timeoutS ? `${o.timeoutS} s for the round` : "the round's time limit"}${o.maxTools ? `, ${o.maxTools} tool calls` : ""}.`],
    TOOLS: [o.tools.length ? `Your tools: ${o.tools.join(", ")}.` : "No tools: answer in text.", "Nothing else: no shell unless a tool above runs one, and a skill never adds a tool."],
    TESTS: g.checks.length ? [`Checks that judge this step's result: ${g.checks.join(", ")}.`] : ["No check runs on this step's result directly; the next steps judge it."],
    DEPENDENCIES: [], DELIVERABLE: [],
  };
  const fallback: Partial<Record<SkeletonKey, string>> = { DEPENDENCIES: "Nothing to install for this step.", DELIVERABLE: "Call this step's recording tool once, then answer in one line." };
  const parts: string[] = ["", "BRIEF SECTIONS (Studio's facts for this round, then the operating manual)"];
  for (const k of SKELETON_SECTIONS) {
    const lines = [...(f[k] ?? []), ...generic[k]];
    if (!lines.length && fallback[k]) lines.push(fallback[k]!);
    const manual = pages.map((p) => [p, manualSection(p, TITLE[k])] as const).filter(([, t]) => t);
    const extra = (f.extra?.[k] ?? []).flatMap((h) => pages.map((p) => [p, h, manualSection(p, h)] as const).filter(([, , t]) => t));
    parts.push("", `## ${k}`, ...lines.map((l) => `- ${l}`));
    for (const [, t] of manual) parts.push("", t!);
    for (const [p, h, t] of extra) parts.push("", `${h}:`, t!, `(Manual: ${p} § ${h})`);
    parts.push(`(Manual: ${manual.length ? manual.map(([p]) => `${p} § ${TITLE[k]}`).join("; ") : `${pages[0]} § ${TITLE[k]}`})`);
  }
  return scrubOperatorPaths(parts.join("\n"), { dataDir: o.dataDir });
}
