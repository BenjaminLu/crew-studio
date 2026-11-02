// The restricted profile of a Task that work from a peer started (docs/units/lan-relay.md). Studio enforces it, not the
// briefing and not the workflow: a LAN-originated Task carries Studio's own marks `_lan` (the received item, its spend
// cap) and `_tainted: "lan"` (src/runtime/engine.ts taintRefusal: OS sandbox only, never local unrestricted mode, never a
// sandbox-off grant; the code pack keeps a tainted Task on its local branch: its review request is local, its end is
// "ready on the local branch", it is never merged or pushed). On top of that, here:
//   - every step is on an allowlist: hooks that only work locally and agent modes that write only their own folder or
//     worktree; a merge, a designer round and any other step is refused when it would start;
//   - a Task with `_tainted: "lan"` and no readable `_lan` is treated as work from a peer with a zero cap (fail closed), and
//     it is never repeated as a new Task (the captain starts again from the Peers inbox);
//   - every round's egress is its provider's API only; no skill script runs; test runs (run_tests, run_command, the checks
//     that run the project's tests) run without the loopback bind and inbound rules, so a test that opens a listener fails;
//     a check that wants the network does not run;
//   - no round writes a protected path (src/lan/paths.ts: CI, hooks, agent and editor settings, runners' config);
//   - the spend cap (agent rounds and dollars, counted on this Mac, reserved before a round is admitted; a round whose
//     provider reports no cost makes the dollars unknown, which stops the next paid round unless the taker chose a
//     rounds-only cap);
//   - its branch is named lan-untrusted/…; Firstmate never gets its questions, title or text; Studio's event log keeps no
//     text of it.
// The hand-back gate (src/lan/runner.ts) refuses an output that touched a protected path, a link, or holds a secret.
import { RoundBlocked } from "../round-blocked";
import { sandboxScope } from "../runtime/checks";
import { writeRefused } from "./paths";

export const LAN_HOOKS = new Set(["note", "set", "intent.capture", "repo.prepare", "repo.cleanup", "deliver.intake", "deliver.round", "deliver.render", "doc.export", "library.publish", "hello.web",
  // the code pack's review request and its end for a tainted Task: local only (LocalPrAdapter, "ready on the local branch")
  "pr.open", "remote.ready"]);
export const LAN_MODES = new Set(["deliver", "spec", "plan", "plan-accept", "build", "review", "rootcause", "test"]);
/** Steps a workflow may contain and still take work from a peer, because a tainted Task never reaches them on its own;
 *  if one is reached anyway it is refused (the runtime check), never run. */
export const LAN_UNREACHED = { hooks: new Set(["git.merge", "branch.adopt"]), modes: new Set(["design-review", "design-gap"]) };
export const LAN_DENIED_TOOLS = new Set(["skill_run"]);
export type LanMark = { item: string; usd: number | null; rounds: number };
/** Studio's LAN mark on a run, or null. A tainted-by-LAN run without a readable mark is held to a zero cap. */
export const lanOf = (run: any): LanMark | null => {
  const v = run?.params?._lan, tainted = run?.params?._tainted === "lan";
  if (!v) return tainted ? { item: "?", usd: 0, rounds: 0 } : null;
  try { const m = JSON.parse(String(v)); const rounds = Number(m.rounds), usd = m.usd === null ? null : Number(m.usd);
    if (!Number.isSafeInteger(rounds) || rounds < 1 || (usd !== null && !(usd >= 0))) throw new Error("bad cap");
    return { item: String(m.item), usd, rounds }; } catch { return { item: "?", usd: 0, rounds: 0 }; }
};
export const peerTask = (run: any) => !!lanOf(run);

/** Why this node may not run on a LAN-originated Task (the runtime check), or null. */
export function nodeRefusal(node: any): string | null {
  if (node.kind === "hook") { const d = String(node.do ?? "note"); return LAN_HOOKS.has(d) ? null : `step ${node.label ?? node.id} (${d}) is not allowed on work from a peer: a LAN-originated Task never pushes, opens a pull request on a remote, merges or changes anything outside its own folder`; }
  if ((node.kind === "agent" || (node.kind === "loop" && node.mode)) && !LAN_MODES.has(String(node.mode ?? ""))) return `step ${node.label ?? node.id} runs agent mode ${node.mode ?? "(none)"}, which is not on the LAN profile`;
  if (node.kind === "card" && node.args?.mode && !["deliver-accept"].includes(String(node.args.mode))) return `step ${node.label ?? node.id} is a ${node.args.mode} card, which is not on the LAN profile`;
  return null;
}
/** Every reason a workflow cannot take work from a peer (empty: it can): the take dialog's static check. */
export function workflowRefusals(def: any): string[] {
  return (def?.nodes ?? []).filter((n: any) => !(n.kind === "hook" && LAN_UNREACHED.hooks.has(String(n.do))) && !(n.kind === "agent" && LAN_UNREACHED.modes.has(String(n.mode))))
    .map((n: any) => nodeRefusal(n)).filter(Boolean) as string[];
}
/** Checks of this node that will not run on a LAN-originated Task (they want the network). */
export function nodeNotRun(node: any, manifest?: (ref: string) => { test_run?: boolean; network?: boolean } | null): string[] {
  return (node.checks ?? []).map((c: any) => String(c?.use ?? "")).filter((ref: string) => !!manifest?.(ref)?.network);
}

/** What a LAN-originated Task has spent on this Mac: its rounds (agent turns, coordinators, judges), their dollars, and
 *  whether any round's dollars are unknown (its provider reported no cost). */
export function spent(engine: any, run: any): { usd: number; rounds: number; unknown: boolean } {
  const seen = new Map<string, number | null>();
  const cost = (j: any) => { const u = j?.cost?.usd; return typeof u === "number" && Number.isFinite(u) ? u : null; };
  for (const rn of Object.values<any>(run.nodes ?? {})) for (const j of rn?.data?.jobs ?? []) seen.set(String(j.id), cost(j));
  for (const j of engine.deps?.agents?.jobs?.values?.() ?? []) if (j.ref === run.id && j.status !== "running") seen.set(String(j.id), cost(j)); // a running one is held as a reservation
  return { usd: [...seen.values()].reduce<number>((a, b) => a + (b ?? 0), 0), rounds: seen.size, unknown: [...seen.values()].some((v) => v === null) };
}
const reserved = new Map<string, number>(); // rounds admitted but not yet counted, per run: the cap holds under concurrency
export function capRefusal(engine: any, run: any, mark: LanMark): string | null {
  const s = spent(engine, run), held = reserved.get(run.id) ?? 0;
  if (s.rounds + held >= mark.rounds) return `spend cap: this received item allows ${mark.rounds} agent round(s) and ${s.rounds + held} ran or are running; Studio stopped before the next one`;
  if (mark.usd !== null && s.unknown) return `spend cap: a round's provider reported no cost, so what this item spent is unknown and its $${mark.usd.toFixed(2)} cap cannot hold; Studio stopped before the next paid round (take it with a rounds-only cap to go on)`;
  if (mark.usd !== null && s.usd >= mark.usd && (s.usd > 0 || mark.usd === 0)) return `spend cap: this received item allows $${mark.usd.toFixed(2)} and $${s.usd.toFixed(2)} was spent; Studio stopped before the next round`;
  return null;
}

export function installLanProfile(engine: any, o: { onStop?: (run: any, why: string) => void } = {}) {
  engine.beforeStart["lan-profile"] = (x: any) => {
    if (!lanOf(x.run)) return null;
    const why = nodeRefusal(x.node);
    if (why) { o.onStop?.(x.run, why); throw new RoundBlocked(why); }
    return null;
  };
  // work from a peer is never repeated as a new Task or a fresh proposal: it would leave the profile's marks behind
  (engine.followUpGuards ??= {})["lan-profile"] = (r: any) => lanOf(r) ? "work from a peer's Studio is not repeated here: take it again from the Peers inbox" : null;
  // the policies a peer's Task resolves: no extra egress, a marked branch, every protected path sensitive
  const policy = engine.policy.bind(engine);
  engine.policy = (r: any, path: string, dflt?: any) => {
    if (!lanOf(r)) return policy(r, path, dflt);
    if (path === "egress.allow") return [];
    if (path === "branch_prefix") return "lan-untrusted/";
    return policy(r, path, dflt);
  };
  // every paid round starts here: the spend cap (reserved before admission), provider egress only, no skill scripts,
  // test runs without local binding, and no write to a protected path
  const agents = engine.deps.agents, run = agents.run.bind(agents);
  agents.run = (opts: any) => {
    const r = opts?.ref ? engine.get?.(opts.ref) : null, mark = r ? lanOf(r) : null;
    if (!r || !mark) return run(opts);
    const over = capRefusal(engine, r, mark);
    if (over) { o.onStop?.(r, over); return Promise.reject(new RoundBlocked(over)); }
    if (!opts.sandbox) return Promise.reject(new RoundBlocked("a LAN-originated round runs only in the round sandbox"));
    const guard = (t: any) => {
      const writes = /(_write|_replace)$/.test(String(t.name));
      return { ...t, run: (a: any) => {
        if (writes && writeRefused(String(a?.path ?? ""))) return { error: `refused: work from a peer may not write ${a?.path} (CI, hooks, agent or editor settings, runner configuration)` };
        return sandboxScope.run({ noLocalBinding: true }, () => t.run(a));
      } };
    };
    reserved.set(r.id, (reserved.get(r.id) ?? 0) + 1);
    const release = () => { const n = (reserved.get(r.id) ?? 1) - 1; if (n > 0) reserved.set(r.id, n); else reserved.delete(r.id); };
    let p: Promise<any>;
    try { p = run({ ...opts, tools: (opts.tools ?? []).filter((t: any) => !LAN_DENIED_TOOLS.has(t.name)).map(guard), sandbox: { ...opts.sandbox, allow: [] } }); } catch (e) { release(); throw e; }
    return Promise.resolve(p).finally(release);
  };
  // checks: never one that wants the network; one that runs the project's tests runs without local binding
  const exec = engine.exec.bind(engine);
  engine.exec = async (x: any, man: any, ...rest: any[]) => {
    if (!lanOf(x.run)) return exec(x, man, ...rest);
    if (man?.network) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `not run: ${man.ref} wants the network, which a LAN-originated Task may not` };
    return sandboxScope.run({ noLocalBinding: true }, () => exec(x, man, ...rest));
  };
  // the prompt's network line says what the round really gets
  const skeleton = engine.briefSkeleton.bind(engine);
  engine.briefSkeleton = (x: any, mode?: string) => { const t = skeleton(x, mode); return lanOf(x.run) ? `${t}\nNETWORK: this Task came from a peer's Studio; only your provider's API is reachable, a test cannot open a listener, no skill script runs, and CI, hook and settings files cannot be written.` : t; };
  // Studio's event log (read by the retro and improve tools) keeps no text of a peer's Task: its type and id only
  const log = engine.deps.log;
  if (log?.emit) { const emit = log.emit.bind(log); log.emit = (e: any) => { const r = e?.task ? engine.get?.(e.task) : null; return emit(r && lanOf(r) ? { ...e, summary: `${e.type} (work from a peer's Studio: its text is not kept in this log)`, data: {} } : e); }; }
}
