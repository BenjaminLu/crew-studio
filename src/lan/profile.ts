// The restricted profile of a Task that work from a peer started (docs/units/lan-relay.md). Studio enforces it, not the
// briefing and not the workflow: a LAN-originated Task carries Studio's own marks `_lan` (the received item, its spend
// cap) and `_tainted: "lan"` (src/runtime/engine.ts taintRefusal: OS sandbox only, never local unrestricted mode, never a
// sandbox-off grant; the code pack keeps such a Task on its local branch: no GitHub adapter, no push, no pull request, no
// merge). On top of that, here:
//   - every step is on an allowlist: hooks that only work locally (never pr.open, git.merge, remote.*, github.*, issue or
//     file moves, registrations, crew or staffing changes), agent modes that write only their own folder or worktree;
//   - every round's egress is its provider's API only (policy egress.allow is dropped), and no round gets run_tests,
//     run_command or a skill script (skill_run): nothing a peer wrote can open a listener or reach the network;
//   - no check that runs the project's tests (a test_run manifest: its loopback opens inbound on macOS) or wants the
//     network runs; it reports why;
//   - the spend cap of the received item (agent rounds and dollars, counted on this Mac) is checked before every step.
// The hand-back gate (src/lan/runner.ts) refuses an output that touched CI, hooks or package scripts.
import { RoundBlocked } from "../round-blocked";

export const LAN_HOOKS = new Set(["note", "set", "intent.capture", "repo.prepare", "repo.cleanup", "deliver.intake", "deliver.round", "deliver.render", "doc.export", "library.publish", "hello.web"]);
export const LAN_MODES = new Set(["deliver", "spec", "plan", "plan-accept", "build", "review", "rootcause", "test"]);
export const LAN_DENIED_TOOLS = new Set(["run_tests", "run_command", "skill_run"]);
export type LanMark = { item: string; usd: number; rounds: number };
export const lanOf = (run: any): LanMark | null => { const v = run?.params?._lan; if (!v) return null; try { const m = JSON.parse(String(v)); return { item: String(m.item), usd: Number(m.usd), rounds: Number(m.rounds) }; } catch { return { item: "?", usd: 0, rounds: 0 }; } };

/** Why this node may not run on a LAN-originated Task, or null (the static check the take dialog uses, and the runtime one). */
export function nodeRefusal(node: any): string | null {
  if (node.kind === "hook") { const d = String(node.do ?? "note"); return LAN_HOOKS.has(d) ? null : `step ${node.label ?? node.id} (${d}) is not allowed on work from a peer: a LAN-originated Task never pushes, opens a pull request, merges or changes anything outside its own folder`; }
  if (node.kind === "agent" && !LAN_MODES.has(String(node.mode ?? ""))) return `step ${node.label ?? node.id} runs agent mode ${node.mode ?? "(none)"}, which is not on the LAN profile`;
  if (node.kind === "loop" && node.mode && !LAN_MODES.has(String(node.mode))) return `step ${node.label ?? node.id} runs agent mode ${node.mode}, which is not on the LAN profile`;
  if (node.kind === "card" && node.args?.mode && !["deliver-accept"].includes(String(node.args.mode))) return `step ${node.label ?? node.id} is a ${node.args.mode} card, which is not on the LAN profile`;
  return null;
}
/** Checks of this node that will report "not run" on a LAN-originated Task (they run the project's tests or want the network). */
export function nodeNotRun(node: any, manifest?: (ref: string) => { test_run?: boolean; network?: boolean } | null): string[] {
  return (node.checks ?? []).map((c: any) => String(c?.use ?? "")).filter((ref: string) => { const m = manifest?.(ref); return !!(m?.test_run || m?.network); });
}
/** Every reason a workflow cannot run work from a peer (empty: it can). */
export function workflowRefusals(def: any): string[] {
  return (def?.nodes ?? []).map((n: any) => nodeRefusal(n)).filter(Boolean) as string[];
}

/** What a LAN-originated Task has spent on this Mac: agent and judge rounds, and their reported dollars. */
export function spent(engine: any, run: any): { usd: number; rounds: number } {
  const seen = new Map<string, number>();
  for (const rn of Object.values<any>(run.nodes ?? {})) for (const j of rn?.data?.jobs ?? []) seen.set(String(j.id), Number(j.cost?.usd) || 0);
  for (const j of engine.deps?.agents?.jobs?.values?.() ?? []) if (j.ref === run.id) seen.set(String(j.id), Number(j.cost?.usd) || 0);
  return { usd: [...seen.values()].reduce((a, b) => a + b, 0), rounds: seen.size };
}

export function installLanProfile(engine: any, o: { onStop?: (run: any, why: string) => void } = {}) {
  const manifest = (ref: string) => { try { return engine.registry?.get?.(ref) ?? null; } catch { return null; } };
  engine.beforeStart["lan-profile"] = (x: any) => {
    const mark = lanOf(x.run); if (!mark) return null;
    const why = nodeRefusal(x.node);
    if (why) { o.onStop?.(x.run, why); throw new RoundBlocked(why); }
    return null;
  };
  // every paid round of a LAN-originated Task (agent turns, coordinator turns, judges) starts here: first the spend cap
  // (counted on this Mac, before the round, so a cap of N rounds runs N), then provider egress only and no test or script tools
  const agents = engine.deps.agents, run = agents.run.bind(agents);
  agents.run = (opts: any) => {
    const r = opts?.ref ? engine.get?.(opts.ref) : null, mark = r ? lanOf(r) : null;
    if (r && mark) {
      const s = spent(engine, r);
      const over = s.rounds >= mark.rounds ? `spend cap: this received item allows ${mark.rounds} agent round(s) and ${s.rounds} ran; Studio stopped before the next one`
        : s.usd > 0 && s.usd >= mark.usd ? `spend cap: this received item allows $${mark.usd.toFixed(2)} and $${s.usd.toFixed(2)} was spent; Studio stopped before the next round` : null;
      if (over) { o.onStop?.(r, over); return Promise.reject(new RoundBlocked(over)); }
      opts = { ...opts, tools: (opts.tools ?? []).filter((t: any) => !LAN_DENIED_TOOLS.has(t.name)), sandbox: opts.sandbox ? { ...opts.sandbox, allow: [] } : opts.sandbox };
    }
    return run(opts);
  };
  // checks: never one that runs the project's tests or wants the network
  const exec = engine.exec.bind(engine);
  engine.exec = async (x: any, man: any, ...rest: any[]) => {
    if (lanOf(x.run) && (man?.test_run || man?.network)) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `not run: ${man.ref} ${man.test_run ? "runs the project's tests" : "wants the network"}, which a LAN-originated Task may not` };
    return exec(x, man, ...rest);
  };
  // the prompt's egress line says what the round really gets
  const skeleton = engine.briefSkeleton.bind(engine);
  engine.briefSkeleton = (x: any, mode?: string) => { const t = skeleton(x, mode); return lanOf(x.run) ? `${t}\nNETWORK: this Task came from a peer's Studio; only your provider's API is reachable, and no test, command or skill script runs.` : t; };
}
