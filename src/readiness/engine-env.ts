// The gate's view of the live engine: what is registered, how a sample round of a node
// would look (its sandbox and its exact brief), built through the same code a real round
// uses (engine.x → instructions → mode.system / mode.prompt). Nothing here materializes a
// folder, starts a job or reads a credential.
import { join } from "node:path";
import { localExecutionNotice } from "../local-execution";
import { OperatingRules, jobInstructions } from "../operating-rules";
import { roundPathRefusal, roundWorkPath } from "../runtime/round-paths";
import { briefFor } from "../runtime/refine";
import { renderEnv } from "../render";
import type { Engine, Run } from "../runtime/engine";
import type { WDef, WNode } from "../runtime/defs";
import { sourceBoundBrief, type ContractEnv, type LoginState, type Sample } from "./stages";
import type { RenderedBrief } from "./types";
import { ownBrief } from "../workflow-drafts";

export type EngineEnvDeps = { engine: Engine; dataDir: string; protectedRoots: string[]; repoRoot?: string | null;
  knownProviders: () => string[] };

/** A run that exists only to render a sample round: never registered, never written. */
export function sampleRun(def: WDef, sample: Sample): Run {
  const now = new Date().toISOString();
  return { id: "R-GATE", workflow: def.id, version: def.version, def, title: def.name, text: ownBrief(def, sample.text, sample.params), params: { ...sample.params }, by: "readiness gate",
    status: "running", result: null, createdAt: now, updatedAt: now, endedAt: null, error: null, nodes: {}, queue: [], steps: [], ctx: {}, classifier: null, events: 0, recovered: 0 } as any;
}
const sampleNode = () => ({ state: "running", visits: 1, extra: 0, attempt: 0, outcome: null, cause: "token", error: null, startedAt: null, endedAt: null, inbox: [], agent: null, swap: null, job: null, card: null, waiting: null, data: {}, note: null }) as any;

export function engineEnv(d: EngineEnvDeps) {
  const { engine } = d;
  const xFor = (def: WDef, node: WNode, sample: Sample) => { const r = sampleRun(def, sample); const rn = sampleNode(); r.nodes[node.id] = rn; return engine.x(r, node, rn); };
  const sandboxOf = (def: WDef, node: WNode, sample: Sample) => {
    const x = xFor(def, node, sample); const mode = engine.modes[node.mode ?? ""];
    // a mode with no folder of its own opens in a scratch folder (engine.roundScratch); its path, without making it
    return mode?.sandbox?.(x) ?? { writes: [engine.roundDirPath(x, "round-scratch", { label: "agent" })], cwd: engine.roundDirPath(x, "round-scratch", { label: "agent" }) };
  };
  /** logins: one snapshot per gate run (read once, never per node) */
  const contract = (def: WDef, sample: Sample, logins: Record<string, LoginState> = {}): ContractEnv => ({
    actions: (n) => !!engine.actions[n], modes: (n) => !!engine.modes[n], cardModes: (n) => !!engine.cardModes[n], cardBodies: (n) => !!engine.cardBodies[n],
    check: (ref) => engine.registry.get(ref) ?? null,
    skillText: (ref) => { try { return engine.deps.skillText(ref); } catch { return null; } },
    skillInfo: engine.defs?.skillInfo ?? null,
    knownProviders: d.knownProviders(), defaultPick: () => { const p = engine.deps.defaultProvider(); return { provider: p.provider, model: p.model ?? null }; },
    login: (p) => logins[p] ?? "unknown",
    sandbox: (df, n) => sandboxOf(df, n, sample),
    pathRefusal: (spec) => roundPathRefusal(d.dataDir, d.protectedRoots, spec),
    roundRoot: join(d.dataDir, "work"),
    forbidden: [{ label: "Studio runs", path: join(d.dataDir, "runs") }, { label: "Studio data", path: d.dataDir }, ...(d.repoRoot ? [{ label: "the repository root", path: d.repoRoot }] : []), ...d.protectedRoots.map((p) => ({ label: "a protected root", path: p }))],
    egressAllow: (df) => ([] as any[]).concat(engine.policies.get("egress.allow", { project: null, workflow: df.policies ?? null }).value ?? []).map(String),
    startInputs: sample.params,
    render: () => { const r = renderEnv(); return { canFilm: r.canFilm, missing: [!r.node && "Node.js", !r.playwright && "Playwright with Chromium", !r.ffmpeg && "ffmpeg"].filter(Boolean) as string[] }; },
  });
  /** Each agent node's exact brief for the sample input: the system text the round gets (safety rules, role, skills) and its prompt. */
  const briefs = (def: WDef, sample: Sample) => def.nodes.filter((n) => n.kind === "agent").map((n) => {
    try {
      const x = xFor(def, n, sample); const mode = engine.modes[n.mode ?? ""]; if (!mode) throw new Error(`no agent mode ${n.mode}`);
      const role = def.roles.find((r) => r.id === n.role); const roleRef = typeof n.skill === "string" && n.skill.startsWith("bundled:workflows/skills/v2/") ? n.skill : role?.skill;
      let roleText = ""; try { roleText = roleRef ? engine.deps.skillText(roleRef) : ""; } catch {}
      // the exact system text a round sends (engine agentTurns → agents.run): safety rules, the captain's operating rules, then the role
      const rules = new OperatingRules(d.dataDir).section(sample.params?.project || null);
      const sourceSystem = mode.system(x, x.skill());
      const system = jobInstructions(sourceSystem, rules);
      x.rn.data.brief = briefFor(x); x.rn.data.notes = [];
      const prompt = mode.prompt(x);
      const sb = sandboxOf(def, n, sample);
      const skills = (Array.isArray(n.skills) ? n.skills : []).map((p) => { try { return { id: p.id, body: engine.deps.library?.body(p.id, p.v, p.sha256) ?? "" }; } catch { return { id: p.id, body: "\u0000missing" }; } });
      // Exempt only the exact suffix jobInstructions appended, never a copied
      // notice in author text. Keep the rest of the rendered system too: marker
      // neutralization can normalize Unicode text into a new absolute path.
      const notice=localExecutionNotice();
      const pathSystem=notice&&!sourceSystem.includes(notice)&&system.endsWith("\n\n"+notice)?system.slice(0,-notice.length):system;
      return sourceBoundBrief({ node: n.id, label: n.label, system, prompt, roundDir: sb.cwd ?? sb.writes[0] ?? roundWorkPath(d.dataDir, "round-scratch", "R-GATE", n.id), roleText, skills, rules: rules.text, error: null }, [pathSystem, sourceSystem, rules.text, roleText, ...skills.map(s=>s.body)].join("\n"));
    } catch (e: any) { return { node: n.id, label: n.label, system: "", prompt: "", roundDir: "", roleText: "", skills: [], rules: "", error: String(e?.message ?? e) }; }
  });
  return { contract, briefs, sandboxOf };
}
export type BriefWithParts = RenderedBrief & { roleText: string; skills: { id: string; body: string }[]; rules: string; error: string | null };
