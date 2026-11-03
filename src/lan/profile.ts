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
//   - the cap is the subscription's quota, never dollars (local providers run on subscriptions): the Task's rounds,
//     counted on this Mac and reserved before a round is admitted; every round at most 15 minutes and 60 tool calls;
//     the Studio-wide daily ceilings over rounds, agent-minutes and tokens (src/lan/ledger.ts); a provider that reports
//     its subscription limit stops the Task at once and pauses peer work on that provider until the captain resumes it;
//   - its branch is named lan-untrusted/…; Firstmate never gets its questions, title or text; Studio's event log keeps no
//     text of it.
// The hand-back gate (src/lan/runner.ts) refuses an output that touched a protected path, a link, or holds a secret.
import { localDay, SpendLedger } from "./ledger";
import { ProfileRefusal } from "../runtime/engine";
import { codeOf } from "../runtime/failures";
import { billingOf } from "./billing";
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
/** a peer's Task's mark: the received item and its rounds cap (a dollar figure an older mark names is ignored) */
export type LanMark = { item: string; rounds: number;
  /** code work that continues from an earlier round: the dispatched base its patch is made against */
  diffBase?: string };
/** The LAN mark of a Task under the "lan" profile, or null. A LAN Task whose mark is not readable is held to a zero cap. */
export const lanOf = (run: any): LanMark | null => {
  if (run?.profile?.name !== "lan") return null;
  const m = run.profile.mark;
  try { const rounds = Number(m?.rounds);
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error("bad cap");
    return { item: String(m.item), rounds, ...(typeof m.diffBase === "string" && /^[0-9a-f]{40}$/.test(m.diffBase) ? { diffBase: m.diffBase } : {}) }; } catch { return { item: "?", rounds: 0 }; }
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

/** One round of a LAN-originated Task, kept on the run itself (run.ctx.lanRounds, saved with the run): recorded when
 *  the round is admitted, what it used when it ends (tokens null: the provider reported none). */
export type LanRound = { n: number; at: string; job: string | null; ended: boolean; tokens?: number | null; minutes?: number | null;
  /** the local day it counts on, and what was reserved for it there while it ran (src/lan/ledger.ts) */
  day?: string; reservedTokens?: number; reservedMinutes?: number;
  /** the part of the round's input read from the prompt cache (kept apart: it counts toward no token ceiling) */
  cacheReadTokens?: number | null;
  /** a round on a sign-in billed per token (an API key): the dollars it reported, shown; never on a subscription */
  billing?: "per-token"; usd?: number | null };
/** every round of a peer's Task, whatever its cap: at most 15 minutes and 60 tool calls; a round that reports more tokens
 *  than this ends the Task's rounds (a token count is known only when the round ends) */
export const LAN_ROUND = { timeoutMs: 15 * 60_000, maxTools: 60, tokens: 2_000_000 };
/** the Studio-wide daily ceilings over every peer's Task (settings on the Peers page, kept in the spend ledger; on by
 *  default): rounds, agent-minutes (rounds' wall clock) and tokens (in and out, as each CLI reports them); a round whose
 *  provider reports no tokens counts at that provider and model's average here, else `unknownRoundTokens`. Null turns
 *  the minute or token ceiling off. No dollars: local providers run on subscriptions. */
export type Ceilings = { dailyRounds: number; dailyMinutes: number | null; dailyTokens: number | null; unknownRoundTokens: number };
export const DEFAULT_CEILINGS: Ceilings = { dailyRounds: 60, dailyMinutes: 300, dailyTokens: 30_000_000, unknownRoundTokens: 300_000 };
/** the minutes a running round is reserved at (its wall-clock ceiling) */
const ROUND_MINUTES = LAN_ROUND.timeoutMs / 60_000;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
/** why the next round of any peer's Task would pass a daily ceiling, from the spend ledger (src/lan/ledger.ts: rounds
 *  admitted today, agent-minutes and tokens used, running rounds at what they reserved), or null. A ledger that cannot
 *  be read is a refusal. */
export function dailyRefusal(ledger: SpendLedger | null, c: Ceilings, next: { tokens: number; minutes: number } = { tokens: 0, minutes: 0 }): string | null {
  if (!ledger) return "daily ceiling: Studio has no record of what work from peers used today; no round of a peer's Task runs without one";
  let d; try { d = ledger.get(localDay()); } catch (e: any) { return `daily ceiling: ${String(e?.message ?? e).slice(0, 300)}; no round of a peer's Task runs until it can be read`; }
  if (d.rounds >= c.dailyRounds) return `daily ceiling: work from peers ran ${d.rounds} paid round(s) on this Mac today, the ceiling is ${c.dailyRounds}; Studio stopped before the next one (Peers page: daily ceilings)`;
  // a round is admitted only if what it reserves still fits under the ceiling
  if (c.dailyMinutes !== null && (d.minutes >= c.dailyMinutes || d.minutes + next.minutes > c.dailyMinutes)) return `daily ceiling: work from peers used ${Math.round(d.minutes)} agent-minutes on this Mac today (running rounds counted at 15), the ceiling is ${c.dailyMinutes}; Studio stopped before the next round (Peers page: daily ceilings)`;
  if (c.dailyTokens !== null && (d.tokens >= c.dailyTokens || d.tokens + next.tokens > c.dailyTokens)) return `daily ceiling: work from peers used ${fmt(d.tokens)} tokens on this Mac today${d.unknown ? `, ${d.unknown} round(s) of them at their provider's average (it reported none)` : ""}, the ceiling is ${fmt(c.dailyTokens)}; Studio stopped before the next round (Peers page: daily ceilings)`;
  return null;
}
/** why a provider takes no peer work now (its subscription limit paused it), or null; a ledger that cannot be read refuses */
export function pausedRefusal(ledger: SpendLedger | null, provider: string | null): string | null {
  if (!ledger || !provider) return null;
  try { const p = ledger.paused().find((x) => x.provider === provider); return p ? `paused: ${provider} reported its subscription limit on a peer's round (${p.why.slice(0, 160)}, ${p.at}); peer work on ${provider} waits until you resume it on the Peers page` : null; }
  catch (e: any) { return `paused: ${String(e?.message ?? e).slice(0, 300)}`; }
}
/** what a round counts toward the token ceilings: input and output as the CLI reports them (cache writes included),
 *  less the cache reads (reported apart by Claude, Codex and Cursor; a cached prefix read again is not new work) */
const tokensOf = (j: any) => { const a = j?.cost?.inTokens, b = j?.cost?.outTokens; if (typeof a !== "number" && typeof b !== "number") return null;
  const cr = typeof j?.cost?.cacheReadTokens === "number" ? j.cost.cacheReadTokens : 0, n = Number(a ?? 0) + Number(b ?? 0) - cr; return Number.isFinite(n) ? Math.max(0, n) : null; };
/** a round that ended because its provider's subscription limit (quota or rate limit) was reached: the provider's own code
 *  (Claude's quotaExhausted), or the words of its error (Codex and Cursor report these as a CLI error) */
export function subscriptionLimit(j: any): string | null {
  if (!j || j.status === "done") return null;
  const text = String(j.error ?? ""), code = String(j.errorCode ?? "");
  if (code === "quotaExhausted") return text || "the provider reported its usage limit";
  const c = codeOf(text); return c === "env.quota" || c === "transient.rate-limit" ? text : null;
}
/** a reset time the provider's limit error gives (an ISO time, or "in N seconds/minutes/hours"), or null: shown on the
 *  Peers page; Studio does not resume by itself */
export function resetOf(text: string, now = Date.now()): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/.exec(text); if (iso) { const t = Date.parse(iso[1]); if (Number.isFinite(t)) return new Date(t).toISOString(); }
  const rel = /\b(?:in|after)\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\b/i.exec(text);
  if (rel) { const n = Number(rel[1]), u = rel[2][0].toLowerCase(); return new Date(now + n * (u === "s" ? 1000 : u === "m" ? 60_000 : 3_600_000)).toISOString(); }
  return null;
}
const providerOf = (opts: any): string | null => typeof opts?.provider === "string" ? opts.provider : opts?.provider?.id ? String(opts.provider.id) : null;
/** What a LAN-originated Task has used on this Mac: every round it was admitted to (agent turns, coordinators, judges),
 *  from its own record, which survives a restart; the tokens and agent-minutes they reported. */
export function spent(_engine: any, run: any): { rounds: number; tokens: number; minutes: number; usd?: number } {
  const rs: LanRound[] = Array.isArray(run?.ctx?.lanRounds) ? run.ctx.lanRounds : [];
  const out: { rounds: number; tokens: number; minutes: number; usd?: number } = { rounds: rs.length, tokens: rs.reduce((a, r) => a + (r.tokens ?? 0), 0), minutes: Math.round(rs.reduce((a, r) => a + (r.minutes ?? 0), 0) * 10) / 10 };
  // dollars only for rounds billed per token (an API-key sign-in) that reported them: a subscription shows none
  const billed = rs.filter((r) => r.billing === "per-token" && typeof r.usd === "number");
  if (billed.length) out.usd = Math.round(billed.reduce((a, r) => a + r.usd!, 0) * 10000) / 10000;
  return out;
}
const persist = (engine: any, run: any, why: string) => { try { engine.commit?.(run, why); } catch {} };
export function capRefusal(engine: any, run: any, mark: LanMark): string | null {
  const s = spent(engine, run);
  if (s.rounds >= mark.rounds) return `rounds cap: this received item allows ${mark.rounds} agent round(s) and ${s.rounds} ran or are running; Studio stopped before the next one`;
  const big = (Array.isArray(run?.ctx?.lanRounds) ? run.ctx.lanRounds : []).find((r: LanRound) => (r.tokens ?? 0) > LAN_ROUND.tokens);
  if (big) return `rounds cap: round ${big.n} used ${big.tokens} tokens, over the per-round ceiling of ${LAN_ROUND.tokens}; Studio stopped before the next round`;
  return null;
}

const NETWORK_LINE = "NETWORK: this Task came from a peer's Studio; only your provider's API is reachable, a test cannot open a listener, no skill script runs, and CI, hook and settings files cannot be written.";
/** The "lan" profile, installed into the engine (it owns the seams; this only fills them). */
export function installLanProfile(engine: any, o: { onStop?: (run: any, why: string) => void; ceilings?: () => Ceilings; ledger?: () => SpendLedger | null;
  /** a provider reported its subscription limit on a peer's round: it is paused in the ledger; this is told (to audit it) */
  onLimit?: (run: any, provider: string, why: string) => void } = {}) {
  const stop = (r: any, why: string) => { o.onStop?.(r, why); return why; };
  // an engine without Studio's data folder (tests) keeps its ledger in memory
  let mem: SpendLedger | null = null; const ledger = () => o.ledger ? o.ledger() : (mem ??= new SpendLedger(":memory:"));
  // the captain's ceilings: from the ledger (always open, whatever the relay does), the defaults when none were set
  const ceilings = (): Ceilings => { try { if (o.ceilings) return o.ceilings(); const c = ledger()?.ceilings(); return c ? { ...DEFAULT_CEILINGS, ...c } : DEFAULT_CEILINGS; } catch { return DEFAULT_CEILINGS; } };
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
      // the provider the round runs on: the one it names, else Studio's default (the one a pause must name)
      const c = ceilings(), L = ledger(), provider = providerOf(opts) ?? (() => { try { const d = engine.deps?.defaultProvider?.(); return d?.provider ? String(d.provider) : null; } catch { return null; } })();
      // what it would reserve: its provider and model's average tokens here, 15 agent-minutes
      const pm = provider ? `${provider}/${opts.provider?.model ?? ""}` : null, day = localDay();
      let reservedTokens = c.unknownRoundTokens; try { if (L) reservedTokens = L.estimate(pm, c.unknownRoundTokens); } catch {}
      const over = capRefusal(engine, r, mark) ?? pausedRefusal(L, provider) ?? dailyRefusal(L, c, { tokens: reservedTokens, minutes: ROUND_MINUTES }); // every round, whatever its provider, counts
      if (over) return Promise.reject(new ProfileRefusal(stop(r, over)));
      if (!opts.sandbox) return Promise.reject(new ProfileRefusal("a LAN-originated round runs only in the round sandbox"));
      // the ledger counts it before it starts, with what it reserves
      try { L!.admit(day, reservedTokens, ROUND_MINUTES); } catch (e: any) { return Promise.reject(new ProfileRefusal(stop(r, `daily ceiling: ${String(e?.message ?? e).slice(0, 300)}`))); }
      const rounds: LanRound[] = (r.ctx ??= {}).lanRounds ??= [], me: LanRound = { n: rounds.length + 1, at: new Date().toISOString(), job: null, ended: false, tokens: null, minutes: null, day, reservedTokens, reservedMinutes: ROUND_MINUTES };
      rounds.push(me); persist(engine, r, "LAN round admitted");
      const t0 = Date.now();
      const book = (tokens: number | null) => { me.minutes = (Date.now() - t0) / 60_000; try { L!.settle(day, { tokens: reservedTokens, minutes: ROUND_MINUTES }, { tokens, minutes: me.minutes }, tokens === null ? null : pm); } catch {} }; // a ledger that fails here keeps the reservation
      // the subscription limit, on whichever path the round ended: the Task stops at once (no retry, no queue), and peer
      // work on the provider the job really ran on (after any fallback) pauses until the captain resumes it
      const limited = (j: any) => {
        const limit = subscriptionLimit(j), ran = j?.provider ? String(j.provider) : provider; if (!limit || !ran) return;
        try { L!.pause(ran, limit, r.id, resetOf(limit)); } catch {}
        try { o.onLimit?.(r, ran, limit); } catch {}
        const why = stop(r, `subscription limit: ${ran} reported it on this round (${limit.slice(0, 200)}); the Task stops, and peer work on ${ran} is paused until you resume it on the Peers page`);
        queueMicrotask(() => { try { engine.cancel?.(r.id, "studio", why); } catch {} });
        throw new ProfileRefusal(why);
      };
      const settle = (j: any) => {
        me.job = j?.id ? String(j.id) : null; me.tokens = tokensOf(j); me.ended = true;
        if (typeof j?.cost?.cacheReadTokens === "number") me.cacheReadTokens = j.cost.cacheReadTokens;
        if (billingOf(j?.provider ? String(j.provider) : provider) === "per-token") { me.billing = "per-token"; me.usd = typeof j?.cost?.usd === "number" ? j.cost.usd : null; }
        book(me.tokens); persist(engine, r, "LAN round counted");
        limited(j);
        return j;
      };
      // the per-round ceilings: wall clock and tool calls, whatever the mode asked for
      const timeoutMs = Math.min(Number(opts.timeoutMs) || LAN_ROUND.timeoutMs, LAN_ROUND.timeoutMs), maxTools = Math.min(Number(opts.maxTools) || LAN_ROUND.maxTools, LAN_ROUND.maxTools);
      return sandboxScope.run({ noLocalBinding: true }, () => Promise.resolve().then(() => next({ ...opts, timeoutMs, maxTools, tools: (opts.tools ?? []).filter((t: any) => !LAN_DENIED_TOOLS.has(t.name)), sandbox: { ...opts.sandbox, allow: [] } })))
        .then(settle, (e: any) => { if (!me.ended) { me.ended = true; book(null); persist(engine, r, "LAN round ended"); }
          if (!(e instanceof ProfileRefusal)) limited({ status: "failed", error: String(e?.message ?? e), errorCode: e?.code ?? null, provider: e?.provider ?? null });
          throw e; });
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
