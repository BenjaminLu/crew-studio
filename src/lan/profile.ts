// The restricted profile of a Task that work from a peer started (docs/units/lan-relay.md). Studio enforces it, not the
// briefing and not the workflow: a LAN-originated Task runs under the runtime's profile "lan" (run.profile, set only by
// the runtime when it starts, never from params; its mark is the received item and its spend cap). The engine calls the
// profile at fixed points for every step of every kind (src/runtime/engine.ts Profile); a seam this profile does not fill
// refuses the step. Every profiled Task runs in the OS sandbox only (engine taintRefusal: never local unrestricted mode,
// never a sandbox-off grant), and the code pack keeps it on its local branch: its review request is local, its end is
// "ready on the local branch", it is never merged or pushed. On top of that, here:
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
import { ProfileRefusal } from "../runtime/engine";
import { sandboxScope } from "../runtime/checks";
import { writeRefused } from "./paths";

// deliver.render is not here: it runs a browser over the agent's own page (scripts allowed), unproven under the round sandbox
export const LAN_HOOKS = new Set(["note", "set", "intent.capture", "repo.prepare", "repo.cleanup", "deliver.intake", "deliver.round", "doc.export", "library.publish", "hello.web",
  // the code pack's review request and its end for a tainted Task: local only (LocalPrAdapter, "ready on the local branch")
  "pr.open", "remote.ready"]);
export const LAN_MODES = new Set(["deliver", "spec", "plan", "plan-accept", "build", "review", "rootcause", "test"]);
/** Steps a workflow may contain and still take work from a peer, because a tainted Task never reaches them on its own;
 *  if one is reached anyway it is refused (the runtime check), never run. */
export const LAN_UNREACHED = { hooks: new Set(["git.merge", "branch.adopt"]), modes: new Set(["design-review", "design-gap"]) };
export const LAN_DENIED_TOOLS = new Set(["skill_run"]);
export type LanMark = { item: string; usd: number | null; rounds: number };
/** The LAN mark of a Task under the "lan" profile, or null. A LAN Task whose mark is not readable is held to a zero cap. */
export const lanOf = (run: any): LanMark | null => {
  if (run?.profile?.name !== "lan") return null;
  const m = run.profile.mark;
  try { const rounds = Number(m?.rounds), usd = m?.usd === null ? null : Number(m?.usd);
    if (!Number.isSafeInteger(rounds) || rounds < 1 || (usd !== null && !(usd >= 0))) throw new Error("bad cap");
    return { item: String(m.item), usd, rounds }; } catch { return { item: "?", usd: 0, rounds: 0 }; }
};
export const peerTask = (run: any) => !!lanOf(run);

/** Why this node may not run on a LAN-originated Task (the runtime check), or null. */
export function nodeRefusal(node: any): string | null {
  // default deny: a kind the profile does not know (one registered later) is refused
  if (!["hook", "agent", "loop", "card", "check"].includes(String(node.kind))) return `step ${node.label ?? node.id} is a ${node.kind} step, which the LAN profile does not know`;
  if (node.kind === "hook") { const d = String(node.do ?? "note"); return LAN_HOOKS.has(d) ? null : `step ${node.label ?? node.id} (${d}) is not allowed on work from a peer: a LAN-originated Task never pushes, opens a pull request on a remote, merges or changes anything outside its own folder`; }
  if ((node.kind === "agent" || (node.kind === "loop" && node.mode)) && !LAN_MODES.has(String(node.mode ?? ""))) return `step ${node.label ?? node.id} runs agent mode ${node.mode ?? "(none)"}, which is not on the LAN profile`;
  if (node.kind === "card" && node.args?.mode && !["deliver-accept"].includes(String(node.args.mode))) return `step ${node.label ?? node.id} is a ${node.args.mode} card, which is not on the LAN profile`;
  return null;
}
/** What a workflow hands back to a peer, as it declares it (data in its definition: `lan: { output: "text" | "patch" }`,
 *  or `lan: { refuse: "<why>" }`), or null when it declares nothing (then it takes no work from a peer). */
export function lanOutput(def: any): { output: "text" | "patch" } | { refuse: string } | null {
  const l = def?.lan; if (!l || typeof l !== "object") return null;
  if (typeof l.refuse === "string" && l.refuse.trim()) return { refuse: l.refuse.trim().slice(0, 300) };
  return l.output === "text" || l.output === "patch" ? { output: l.output } : null;
}
/** Whether this machine can enforce the profile's no-binding scope (macOS: the round and test sandboxes drop inbound) */
export const profileEnforced = () => process.platform === "darwin";
/** Every reason a workflow cannot take work from a peer (empty: it can): the take dialog's static check. Eligible means:
 *  every step is on the profile, it declares text or a patch as what it hands back, and this machine enforces the profile. */
export function workflowRefusals(def: any): string[] {
  const out: string[] = [];
  if (!profileEnforced()) out.push("this Studio cannot take work from a peer: the restricted profile's no-binding scope is enforced only on macOS");
  const o = lanOutput(def);
  if (!o) out.push(`${def?.id ?? "this workflow"} does not declare what it would hand back (lan.output: text or patch), so it takes no work from a peer`);
  else if ("refuse" in o) out.push(`${def?.id ?? "this workflow"} takes no work from a peer: ${o.refuse}`);
  return [...out, ...(def?.nodes ?? []).filter((n: any) => !(n.kind === "hook" && LAN_UNREACHED.hooks.has(String(n.do))) && !(n.kind === "agent" && LAN_UNREACHED.modes.has(String(n.mode))))
    .map((n: any) => nodeRefusal(n)).filter(Boolean) as string[]];
}
/** Steps a workflow holds that a LAN Task does not reach on its own, refused at run time if it ever does: shown at the
 *  take as "may stop at step X" */
export function mayStop(def: any): string[] {
  return (def?.nodes ?? []).filter((n: any) => (n.kind === "hook" && LAN_UNREACHED.hooks.has(String(n.do))) || (n.kind === "agent" && LAN_UNREACHED.modes.has(String(n.mode)))).map((n: any) => String(n.label ?? n.id));
}
/** Checks of this node that will not run on a LAN-originated Task (they want the network). */
export function nodeNotRun(node: any, manifest?: (ref: string) => { test_run?: boolean; network?: boolean } | null): string[] {
  return (node.checks ?? []).map((c: any) => String(c?.use ?? "")).filter((ref: string) => !!manifest?.(ref)?.network);
}

/** One paid round of a LAN-originated Task, kept on the run itself (run.ctx.lanRounds, saved with the run): recorded
 *  when the round is admitted, its dollars when it ends (null: the provider reported none, or it has not ended). */
export type LanRound = { n: number; at: string; job: string | null; usd: number | null; ended: boolean; tokens?: number | null };
/** every paid round of a peer's Task, whatever its cap: at most 15 minutes, at most 60 tool calls; a round that reports
 *  more tokens than this ends the Task's paid rounds (a token count is known only when the round ends) */
export const LAN_ROUND = { timeoutMs: 15 * 60_000, maxTools: 60, tokens: 2_000_000 };
/** the Studio-wide daily ceilings over every peer's Task (settings on the Peers page; on by default) */
export type Ceilings = { dailyUsd: number | null; dailyRounds: number; unknownRoundUsd: number };
export const DEFAULT_CEILINGS: Ceilings = { dailyUsd: 20, dailyRounds: 60, unknownRoundUsd: 1 };
const today = () => new Date().toISOString().slice(0, 10);
/** what every peer's Task spent today on this Mac: rounds, reported dollars, and rounds whose dollars are unknown */
export function dailySpent(engine: any): { rounds: number; usd: number; unknown: number } {
  let rounds = 0, usd = 0, unknown = 0;
  for (const r of engine.list?.() ?? []) { if (!lanOf(r)) continue;
    for (const x of (Array.isArray(r.ctx?.lanRounds) ? r.ctx.lanRounds : []) as LanRound[]) { if (String(x.at).slice(0, 10) !== today()) continue; rounds++; if (x.usd === null) unknown++; else usd += x.usd; } }
  return { rounds, usd, unknown };
}
/** why the next paid round of any peer's Task would pass a daily ceiling (unknown dollars count at the estimate), or null */
export function dailyRefusal(engine: any, c: Ceilings): string | null {
  const d = dailySpent(engine);
  if (d.rounds >= c.dailyRounds) return `daily ceiling: work from peers ran ${d.rounds} paid round(s) on this Mac today, the ceiling is ${c.dailyRounds}; Studio stopped before the next one (Peers page: daily ceilings)`;
  const worst = d.usd + d.unknown * c.unknownRoundUsd;
  if (c.dailyUsd !== null && worst >= c.dailyUsd) return `daily ceiling: work from peers spent $${d.usd.toFixed(2)} today${d.unknown ? ` and ${d.unknown} round(s) of unknown cost (counted at $${c.unknownRoundUsd.toFixed(2)} each)` : ""}, the ceiling is $${c.dailyUsd.toFixed(2)}; Studio stopped before the next round (Peers page: daily ceilings)`;
  return null;
}
const cost = (j: any) => { const u = j?.cost?.usd; return typeof u === "number" && Number.isFinite(u) ? u : null; };
const tokensOf = (j: any) => { const a = Number(j?.cost?.inTokens ?? 0), b = Number(j?.cost?.outTokens ?? 0); return Number.isFinite(a + b) && a + b > 0 ? a + b : null; };
/** What a LAN-originated Task has spent on this Mac: every paid round it was admitted to (agent turns, coordinators,
 *  judges), from its own record, which survives a restart; their dollars; whether any ended round's dollars are unknown. */
export function spent(_engine: any, run: any): { usd: number; rounds: number; unknown: boolean } {
  const rs: LanRound[] = Array.isArray(run?.ctx?.lanRounds) ? run.ctx.lanRounds : [];
  // a round admitted by an earlier Studio process and never settled (it stopped mid-round): its dollars are unknown
  return { usd: rs.reduce((a, r) => a + (r.usd ?? 0), 0), rounds: rs.length, unknown: rs.some((r) => r.usd === null && (r.ended || !live.has(r))) };
}
/** rounds this process admitted and has not settled yet */
const live = new WeakSet<object>();
const persist = (engine: any, run: any, why: string) => { try { engine.commit?.(run, why); } catch {} };
export function capRefusal(engine: any, run: any, mark: LanMark): string | null {
  const s = spent(engine, run);
  if (s.rounds >= mark.rounds) return `spend cap: this received item allows ${mark.rounds} agent round(s) and ${s.rounds} ran or are running; Studio stopped before the next one`;
  const big = (Array.isArray(run?.ctx?.lanRounds) ? run.ctx.lanRounds : []).find((r: LanRound) => (r.tokens ?? 0) > LAN_ROUND.tokens);
  if (big) return `spend cap: round ${big.n} used ${big.tokens} tokens, over the per-round ceiling of ${LAN_ROUND.tokens}; Studio stopped before the next round`;
  if (mark.usd !== null && s.unknown) return `spend cap: a round's provider reported no cost, so what this item spent is unknown and its $${mark.usd.toFixed(2)} cap cannot hold; Studio stopped before the next paid round (take it with a rounds-only cap to go on)`;
  if (mark.usd !== null && s.usd >= mark.usd && (s.usd > 0 || mark.usd === 0)) return `spend cap: this received item allows $${mark.usd.toFixed(2)} and $${s.usd.toFixed(2)} was spent; Studio stopped before the next round`;
  return null;
}

const NETWORK_LINE = "NETWORK: this Task came from a peer's Studio; only your provider's API is reachable, a test cannot open a listener, no skill script runs, and CI, hook and settings files cannot be written.";
/** The "lan" profile, installed into the engine (it owns the seams; this only fills them). */
export function installLanProfile(engine: any, o: { onStop?: (run: any, why: string) => void; ceilings?: () => Ceilings } = {}) {
  const stop = (r: any, why: string) => { o.onStop?.(r, why); return why; };
  engine.profiles.lan = {
    // every step, whatever its kind: hooks and agent modes on the allowlist, plain cards, checks; nothing else
    admit: (x: any) => { const why = nodeRefusal(x.node); return why ? stop(x.run, why) : null; },
    // every step of a peer's Task runs in the no-binding scope: its agent rounds' and its installs' sandboxes drop inbound
    wrapStep: (_x: any, fn: () => Promise<any>) => sandboxScope.run({ noLocalBinding: true }, fn),
    // the policies a peer's Task resolves: no extra egress, a marked branch, no dependency install and no install scripts
    policy: (_r: any, path: string, base: any) => path === "egress.allow" ? [] : path === "branch_prefix" ? "lan-untrusted/" : path === "install" || path === "install_scripts" ? false : base,
    // every paid round: the spend cap (reserved before admission), the round sandbox with provider egress only, no skill
    // scripts, no local binding; recorded on the Task itself before it starts, its dollars when it ends
    wrapRound: (r: any, opts: any, next: (o: any) => Promise<any>) => {
      const mark = lanOf(r)!;
      const over = capRefusal(engine, r, mark) ?? dailyRefusal(engine, (() => { try { return o.ceilings?.() ?? DEFAULT_CEILINGS; } catch { return DEFAULT_CEILINGS; } })()); // every paid round, whatever its provider, counts
      if (over) return Promise.reject(new ProfileRefusal(stop(r, over)));
      if (!opts.sandbox) return Promise.reject(new ProfileRefusal("a LAN-originated round runs only in the round sandbox"));
      const rounds: LanRound[] = (r.ctx ??= {}).lanRounds ??= [], me: LanRound = { n: rounds.length + 1, at: new Date().toISOString(), job: null, usd: null, ended: false };
      rounds.push(me); live.add(me); persist(engine, r, "LAN round admitted");
      const settle = (j: any) => { me.job = j?.id ? String(j.id) : null; me.usd = cost(j); me.tokens = tokensOf(j); me.ended = true; persist(engine, r, "LAN round counted"); return j; };
      // the per-round ceilings: wall clock and tool calls, whatever the mode asked for
      const timeoutMs = Math.min(Number(opts.timeoutMs) || LAN_ROUND.timeoutMs, LAN_ROUND.timeoutMs), maxTools = Math.min(Number(opts.maxTools) || LAN_ROUND.maxTools, LAN_ROUND.maxTools);
      return sandboxScope.run({ noLocalBinding: true }, () => Promise.resolve().then(() => next({ ...opts, timeoutMs, maxTools, tools: (opts.tools ?? []).filter((t: any) => !LAN_DENIED_TOOLS.has(t.name)), sandbox: { ...opts.sandbox, allow: [] } })))
        .then(settle, (e: any) => { me.ended = true; persist(engine, r, "LAN round ended"); throw e; });
    },
    // every tool: no write to a protected path, and it runs without local binding
    wrapTool: (_r: any, t: any) => {
      const writes = /(_write|_replace)$/.test(String(t?.name));
      return { ...t, run: (a: any) => {
        if (writes && writeRefused(String(a?.path ?? ""))) return { error: `refused: work from a peer may not write ${a?.path} (CI, hooks, agent or editor settings, runner configuration)` };
        return sandboxScope.run({ noLocalBinding: true }, () => t.run(a));
      } };
    },
    // checks: never one that wants the network; one that runs the project's tests runs without local binding
    wrapExec: (_x: any, man: any, next: () => Promise<any>) => man?.network
      ? Promise.resolve({ verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `not run: ${man.ref} wants the network, which a LAN-originated Task may not` })
      : sandboxScope.run({ noLocalBinding: true }, next),
    // its text never reaches Firstmate, Studio's log or another Task
    redact: () => true,
    // work from a peer is never repeated as a new Task or a fresh proposal: it is taken again from the Peers inbox
    followUp: () => "work from a peer's Studio is not repeated here: take it again from the Peers inbox",
    // the prompt's network line says what the round really gets
    brief: (_x: any, text: string) => `${text}\n${NETWORK_LINE}`,
  };
}
