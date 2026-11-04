import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// What work from a peer may use on this Mac (docs/units/lan-relay.md, Spend). Local providers run on subscriptions, so
// the resource is the subscription's quota, never dollars: a peer's Task is capped by its rounds; every round is at most
// 15 minutes and 60 tool calls (and a round over the token ceiling ends the Task's rounds); the Studio-wide daily
// ceilings count rounds, agent-minutes and tokens (a round with no token report at its provider's average, kept if it is
// never settled), per local day, in the spend ledger; a provider that reports its subscription limit stops that Task at
// once and pauses peer work on that provider until the captain resumes it. The taker's opt-in auto-start starts an
// assigned round only when every check still holds.                                              bun tests/lan-spend.ts
import { mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capRefusal, dailyRefusal, installLanProfile, LAN_ROUND, DEFAULT_CEILINGS } from "../src/lan/profile";
import { SpendLedger, localDay } from "../src/lan/ledger";
import { Lan, type LanRunner } from "../src/lan/relay";
import { LIMITS } from "../src/lan/protocol";
import { Agents } from "../src/agent";

process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
process.env.TZ = "Asia/Taipei"; // the daily ceilings reset at local midnight: a zone away from UTC shows it
let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await Bun.sleep(25); } return true; };
const now = () => new Date().toISOString();
const lanTask = (id: string, rounds: number, lanRounds: any[] = []) => ({ id, params: {}, nodes: {}, ctx: { lanRounds }, profile: { name: "lan", mark: { item: id, rounds } } });
const ledgerAt = () => new SpendLedger(join(mkdtempSync(join(tmpdir(), "crew-lan-ledger-")), "lan", "spend.db"));
const job = (o: { tokens?: number | null; status?: string; error?: string; code?: string } = {}) => async () => (await Bun.sleep(5), { id: `J-${Math.random()}`, status: o.status ?? "done", error: o.error ?? null, ...(o.code ? { errorCode: o.code } : {}),
  cost: o.tokens === null ? { usd: null, inTokens: null, outTokens: null } : { usd: null, inTokens: o.tokens ?? 1000, outTokens: 0 } });
const seams = (L: SpendLedger, ceil: () => any = () => DEFAULT_CEILINGS, extra: any = {}) => { const cancels: string[] = [], limits: any[] = [];
  const e: any = { profiles: {}, commit: () => {}, list: () => [], cancel: (id: string) => { cancels.push(id); }, ...extra };
  installLanProfile(e, { ledger: () => L, ceilings: ceil, onLimit: (r: any, provider: string, why: string) => limits.push({ run: r.id, provider, why }) }); return { P: e.profiles.lan, cancels, limits }; };
const opts = (r: any, provider: any = { id: "codex", model: "m1" }, extra: any = {}) => ({ ref: r.id, sandbox: { writes: [] }, tools: [], provider, ...extra });

// 1. the per-round ceilings: whatever the mode asks for, a round of a peer's Task gets at most 15 minutes and 60 tool calls
{ const { P } = seams(ledgerAt()); const r = lanTask("R-1", 9); let seen: any = null;
  await P.wrapRound(r, opts(r, undefined, { timeoutMs: 3 * 3600_000, maxTools: 400 }), async (o: any) => { seen = o; return { id: "J-1", status: "done", cost: { usd: null, inTokens: 3_000_000, outTokens: 10 } }; });
  ok(seen?.timeoutMs === LAN_ROUND.timeoutMs && seen?.maxTools === LAN_ROUND.maxTools, "a peer's round gets at most 15 minutes and 60 tool calls, whatever its mode asked for", JSON.stringify([seen?.timeoutMs, seen?.maxTools]));
  let e2 = ""; try { await P.wrapRound(r, opts(r), job()); } catch (x: any) { e2 = String(x?.message); }
  ok(/over the per-round ceiling/.test(e2) && r.ctx.lanRounds[0].tokens === 3_000_010, "a round over the per-round token ceiling stops the next one", e2); }

// 2. the per-Task cap is rounds only: no dollar cap anywhere (a mark that still names dollars is held to its rounds)
{ const { P } = seams(ledgerAt()); const r: any = lanTask("R-2", 2); r.profile.mark.usd = 0; // a legacy dollar figure: ignored
  let n = 0, last = ""; for (let i = 0; i < 4; i++) { try { await P.wrapRound(r, opts(r), job({ tokens: null })); n++; } catch (x: any) { last = String(x?.message); } }
  ok(n === 2 && /allows 2 agent round/.test(last) && !/\$|dollar|cost/.test(last), "a peer's Task runs its rounds cap, unknown token counts included, and nothing about dollars stops or is said", `${n} ${last}`);
  ok(capRefusal({}, { id: "R-x", ctx: { lanRounds: [{ n: 1, at: now(), job: null, ended: false }] } }, { item: "i", rounds: 1 }) !== null, "a round admitted before a restart and never settled still counts toward the rounds cap"); }

// 3. the daily ceilings, from the ledger: rounds, agent-minutes, tokens; a round with no token report at its provider and
//    model's average (a fixed default with no record), kept when it never reports
{ const L = ledgerAt(); let ceil: any = { ...DEFAULT_CEILINGS }; const { P } = seams(L, () => ceil);
  const ra = lanTask("R-a", 9), rb = lanTask("R-b", 9);
  await P.wrapRound(ra, opts(ra, { id: "codex", model: "m1" }), job({ tokens: 4000 }));
  await P.wrapRound(rb, opts(rb, { id: "codex", model: "m1" }), job({ tokens: null })); // no report: counted at codex/m1's average, 4000
  await P.wrapRound(rb, opts(rb, { id: "cursor", model: "x" }), job({ tokens: null })); // no record for cursor/x: the default
  const d = L.get();
  ok(d.rounds === 3 && d.unknown === 2 && d.tokens === 4000 + 4000 + DEFAULT_CEILINGS.unknownRoundTokens, "every round counts; one with no token report counts at its provider and model's average, or at the default with no record", JSON.stringify(d));
  ok(dailyRefusal(L, { ...ceil, dailyTokens: d.tokens + 1 }) === null && /daily ceiling: .*tokens/.test(dailyRefusal(L, { ...ceil, dailyTokens: d.tokens }) ?? ""), "the daily token ceiling refuses the next round once reached (unknown rounds at their estimate)", String(dailyRefusal(L, { ...ceil, dailyTokens: d.tokens })));
  ok(/ran 3 paid round/.test(dailyRefusal(L, { ...ceil, dailyRounds: 3 }) ?? ""), "the daily round ceiling counts every peer's Task");
  ok(d.minutes > 0 && d.minutes < 1, "agent-minutes count each round's wall clock", String(d.minutes));
  ok(/agent-minutes/.test(dailyRefusal(L, { ...ceil, dailyMinutes: d.minutes }) ?? ""), "the daily agent-minute ceiling refuses the next round once reached");
  ok(!/\$|dollar/.test(JSON.stringify(DEFAULT_CEILINGS)) && !("dailyUsd" in DEFAULT_CEILINGS), "there is no daily dollar ceiling", JSON.stringify(DEFAULT_CEILINGS));
  // a running round reserves 15 minutes and its estimate, then counts what it used
  const rc = lanTask("R-c", 9); let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  const b0 = L.get(), running = P.wrapRound(rc, opts(rc, { id: "codex", model: "m1" }), async () => { await gate; return { id: "J", status: "done", cost: { usd: null, inTokens: 900, outTokens: 100 } }; });
  await Bun.sleep(20); const mid = L.get(); release(); await running; const end = L.get();
  ok(mid.tokens - b0.tokens === 4000 && Math.abs(mid.minutes - b0.minutes - 15) < 1e-9 && end.tokens - b0.tokens === 1000 && end.minutes - b0.minutes < 1, "a running round reserves its provider's average tokens and 15 agent-minutes, then counts what it used", JSON.stringify({ mid: [mid.tokens - b0.tokens, mid.minutes - b0.minutes], end: [end.tokens - b0.tokens, end.minutes - b0.minutes] }));
  ok(localDay(new Date("2026-03-01T17:30:00Z")) === "2026-03-02" && localDay(new Date("2026-03-01T15:30:00Z")) === "2026-03-01", "the daily ceilings reset at local midnight (Asia/Taipei here), not UTC");
  ceil = { ...DEFAULT_CEILINGS, dailyRounds: L.get().rounds }; const rd = lanTask("R-d", 9);
  let e3 = ""; try { await P.wrapRound(rd, opts(rd), job()); } catch (x: any) { e3 = String(x?.message); }
  ok(/daily ceiling/.test(e3) && !rd.ctx.lanRounds.length, "a round past a daily ceiling is refused before it starts", e3);
  // a ledger that cannot be read refuses every round
  const bad = join(mkdtempSync(join(tmpdir(), "crew-lan-ledger-bad-")), "spend.db"); writeFileSync(bad, "damaged\n".repeat(400));
  const { P: P2 } = seams(new SpendLedger(bad)); const re = lanTask("R-e", 9); let e4 = ""; try { await P2.wrapRound(re, opts(re), job()); } catch (x: any) { e4 = String(x?.message); }
  ok(/cannot be read/.test(e4) && !re.ctx.lanRounds.length, "a spend ledger that cannot be read refuses every round of a peer's Task", e4);
  // the daily check itself fails closed, not only the paused-provider check before it: a round whose provider is not
  // named (no pause to look up) is refused too
  const rf = lanTask("R-f", 9); let e7 = ""; try { await P2.wrapRound(rf, opts(rf, null), job()); } catch (x: any) { e7 = String(x?.message); }
  ok(/daily ceiling: .*cannot be read/.test(e7) && !rf.ctx.lanRounds.length, "a spend ledger that cannot be read refuses a round with no provider named (the daily check fails closed on its own)", e7); }

// 3b. a round is admitted only if what it reserves still fits: 299 of 300 agent-minutes leaves no room for a 15-minute
//     round, and a token reservation that would cross the token ceiling is refused the same way
{ const L = ledgerAt(); const { P } = seams(L, () => ({ ...DEFAULT_CEILINGS, dailyMinutes: 300, dailyTokens: 1_000_000 }));
  L.admit(localDay(), 0, 299); L.settle(localDay(), { tokens: 0, minutes: 299 }, { tokens: 0, minutes: 299 }, null);
  const r = lanTask("R-res", 9); let e = ""; try { await P.wrapRound(r, opts(r), job()); } catch (x: any) { e = String(x?.message); }
  ok(/agent-minutes/.test(e) && !r.ctx.lanRounds.length, "with 299 of 300 agent-minutes used, a round that reserves 15 more is refused before it starts", e);
  const L2 = ledgerAt(); const { P: P2 } = seams(L2, () => ({ ...DEFAULT_CEILINGS, dailyTokens: 1_000_000, unknownRoundTokens: 300_000 }));
  L2.admit(localDay(), 800_000, 0); const r2 = lanTask("R-res2", 9); let e2 = ""; try { await P2.wrapRound(r2, opts(r2, { id: "nobody", model: "x" }), job()); } catch (x: any) { e2 = String(x?.message); }
  ok(/tokens/.test(e2) && !r2.ctx.lanRounds.length, "a round whose token reservation would cross the token ceiling is refused before it starts", e2); }

// 4. the captain's ceilings live in the ledger (they hold with the relay closed); a ledger deleted or restored older is broken
{ const dir = mkdtempSync(join(tmpdir(), "crew-lan-ceil-")), L = new SpendLedger(join(dir, "lan", "spend.db"));
  const none: any = { workflows: () => [], start: async () => { throw new Error("no"); }, status: () => null, output: async () => { throw new Error("no"); }, cancel: () => {} };
  const lan = await Lan.open({ dataDir: dir, runner: none, bind: "127.0.0.1", port: 0, spend: L } as any);
  let bad = ""; try { lan.setCeilings({ dailyUsd: 5 } as any); } catch (x: any) { bad = String(x?.message); }
  lan.setCeilings({ dailyRounds: 2, dailyMinutes: 30, dailyTokens: 50_000 }); lan.close();
  ok(/dollar/.test(bad) && JSON.stringify(L.ceilings()) === JSON.stringify({ ...DEFAULT_CEILINGS, dailyRounds: 2, dailyMinutes: 30, dailyTokens: 50_000 }), "the daily ceilings are rounds, agent-minutes and tokens, kept in the ledger (a dollar ceiling is refused)", JSON.stringify([bad, L.ceilings()]));
  const e: any = { profiles: {}, commit: () => {}, list: () => [] }; installLanProfile(e, { ledger: () => L }); // no relay: its ceilings come from the ledger
  const r = lanTask("R-ceil", 9); L.admit(localDay(), 50_000, 1);
  let err = ""; try { await e.profiles.lan.wrapRound(r, opts(r), job()); } catch (x: any) { err = String(x?.message); }
  ok(/daily ceiling: .*tokens/.test(err), "a captain's token ceiling holds with the relay closed (it lives in the spend ledger, not the relay's sealed state)", err);
  L.close(); const f = join(dir, "lan", "spend.db"); copyFileSync(f, join(dir, "old.db"));
  { const L2 = new SpendLedger(f); L2.admit("2026-01-01", 1, 1); L2.close(); }
  for (const x of ["", "-wal", "-shm"]) rmSync(f + x, { force: true }); copyFileSync(join(dir, "old.db"), f);
  ok(/fewer|older/.test(String(new SpendLedger(f).broken)), "a spend ledger restored from an older copy is broken (no round runs), never a lower day");
  for (const x of ["", "-wal", "-shm"]) rmSync(f + x, { force: true });
  ok(/missing/.test(String(new SpendLedger(f).broken)), "a spend ledger that was deleted is not made again empty: it is broken"); }

// 5. the subscription limit: a provider that reports it (Claude's quotaExhausted, Codex's or Cursor's rate- or usage-limit
//    error) stops that Task at once, with no retry, and pauses peer work on that provider until the captain resumes it
{ const L = ledgerAt(); const { P, cancels, limits } = seams(L);
  const cases: [string, any, any][] = [
    ["claude", { id: "claude", model: "claude-opus-5-5" }, { status: "failed", error: "the provider's usage limit is reached", code: "quotaExhausted" }],
    ["codex", { id: "codex", model: "gpt" }, { status: "failed", error: "stream error: 429 Too Many Requests: rate limit reached for requests", code: "cliError" }],
    ["cursor", { id: "cursor", model: "auto" }, { status: "failed", error: "You've hit your usage limit for this plan", code: "cliError" }]];
  for (const [name, prov, j] of cases) {
    const r = lanTask(`R-${name}`, 9); let e = ""; try { await P.wrapRound(r, opts(r, prov), job(j)); } catch (x: any) { e = String(x?.message); }
    await Bun.sleep(5);
    ok(/subscription limit/.test(e) && cancels.includes(r.id) && L.paused().some((p) => p.provider === name) && limits.some((x) => x.run === r.id && x.provider === name), `${name}: a round that reports the subscription limit stops its Task at once and pauses peer work on ${name}`, JSON.stringify([e, cancels, L.paused()]));
    const r2 = lanTask(`R-${name}-2`, 9); let e2 = ""; try { await P.wrapRound(r2, opts(r2, prov), job()); } catch (x: any) { e2 = String(x?.message); }
    ok(/paused/.test(e2) && !r2.ctx.lanRounds.length, `${name}: while paused, no round of any peer's Task runs on ${name}`, e2); }
  const other = lanTask("R-other", 9); let e5 = ""; try { await P.wrapRound(other, opts(other, { id: "codex", model: "gpt" }), job({ status: "failed", error: "exit code 2", code: "cliError" })); } catch (x: any) { e5 = String(x?.message); }
  ok(!cancels.includes(other.id), "an ordinary provider failure is not a subscription limit (it pauses nothing more)", e5);
  L.resume("codex"); const r3 = lanTask("R-resumed", 9); let e6 = ""; try { await P.wrapRound(r3, opts(r3, { id: "codex", model: "gpt" }), job()); } catch (x: any) { e6 = String(x?.message); }
  ok(!e6 && !L.paused().some((p) => p.provider === "codex"), "once the captain resumes the provider, its rounds run again", e6); }

// 5b. the limit on every path, for the provider that really ran: a round that rejects with a quota or rate-limit error
//     pauses its provider too; a round on Studio's default provider (none named) pauses that one; the provider the job
//     ran on (after a fallback) is the one paused; a reset time the provider gives is kept and shown, never acted on
{ const L = ledgerAt(); const { P, cancels } = seams(L, () => DEFAULT_CEILINGS, { deps: { defaultProvider: () => ({ provider: "cursor", model: "auto" }) } });
  const r1 = lanTask("R-rej", 9); let e1 = "";
  try { await P.wrapRound(r1, opts(r1, { id: "codex", model: "gpt" }), async () => { throw Object.assign(new Error("stream error: 429 Too Many Requests: rate limit reached"), { code: "cliError" }); }); } catch (x: any) { e1 = String(x?.message); }
  await Bun.sleep(5);
  ok(/subscription limit/.test(e1) && L.paused().some((p) => p.provider === "codex") && cancels.includes(r1.id), "a round that rejects with a rate-limit error pauses its provider and stops its Task, as a resolved one does", JSON.stringify([e1, L.paused()]));
  const r2 = lanTask("R-default", 9); let e2 = "";
  try { await P.wrapRound(r2, opts(r2, null), job({ status: "failed", error: "You've hit your usage limit", code: "cliError" })); } catch (x: any) { e2 = String(x?.message); }
  ok(L.paused().some((p) => p.provider === "cursor") && /cursor/.test(e2), "a round on Studio's default provider (none named) pauses that provider", JSON.stringify([e2, L.paused()]));
  const r3 = lanTask("R-default-2", 9); let e3 = ""; try { await P.wrapRound(r3, opts(r3, null), job()); } catch (x: any) { e3 = String(x?.message); }
  ok(/paused: cursor/.test(e3) && !r3.ctx.lanRounds.length, "while the default provider is paused, a round on it with no provider named is refused", e3);
  const r4 = lanTask("R-fallback", 9); let e4 = "";
  try { await P.wrapRound(r4, opts(r4, { id: "stub", model: "x" }), async () => (await Bun.sleep(1), { id: "J-f", provider: "claude", status: "failed", error: "usage limit reached, resets at 2026-11-03T12:00:00Z", errorCode: "quotaExhausted", cost: null })); } catch (x: any) { e4 = String(x?.message); }
  const pc = L.paused().find((p) => p.provider === "claude");
  ok(!!pc && !L.paused().some((p) => p.provider === "stub"), "the provider the job really ran on (after a fallback) is the one paused", JSON.stringify(L.paused()));
  ok(pc?.resets === "2026-11-03T12:00:00.000Z", "a reset time the provider gives is kept with the pause (shown; Studio still waits for the captain)", JSON.stringify(pc)); }

// 5c. tokens: cache reads are counted apart and left out of both token ceilings (input, output and cache writes count)
{ const { claudeUsage } = await import("../src/providers/claude") as any, { codexUsage } = await import("../src/providers/codex") as any, { cursorUsage } = await import("../src/providers/cursor") as any;
  const cu = claudeUsage({ total_cost_usd: 0.5, usage: { input_tokens: 1000, cache_read_input_tokens: 900_000, cache_creation_input_tokens: 20_000, output_tokens: 3000 } });
  const xu = codexUsage({ input_tokens: 800_000, cached_input_tokens: 700_000, output_tokens: 5000 });
  const ru = cursorUsage({ inputTokens: 2000, cacheReadTokens: 500_000, cacheWriteTokens: 4000, outputTokens: 1000 });
  ok(cu.cacheReadTokens === 900_000 && cu.inTokens === 921_000 && xu.cacheReadTokens === 700_000 && xu.inTokens === 800_000 && ru.cacheReadTokens === 500_000 && ru.inTokens === 506_000, "each provider's cache reads are reported apart (Claude, Codex and Cursor all separate them)", JSON.stringify([cu, xu, ru]));
  const L = ledgerAt(); const { P } = seams(L); const r = lanTask("R-cache", 9);
  await P.wrapRound(r, opts(r, { id: "claude", model: "m" }), async () => ({ id: "J-c", status: "done", cost: { usd: null, inTokens: 1_921_000, outTokens: 3000, cacheReadTokens: 1_900_000 } }));
  ok(r.ctx.lanRounds[0].tokens === 24_000 && r.ctx.lanRounds[0].cacheReadTokens === 1_900_000 && L.get().tokens === 24_000, "a round's cache reads do not count toward the per-round or daily token ceilings (they are kept apart)", JSON.stringify([r.ctx.lanRounds[0], L.get()]));
  let e = ""; try { await P.wrapRound(r, opts(r, { id: "claude", model: "m" }), job()); } catch (x: any) { e = String(x?.message); }
  ok(!/over the per-round ceiling/.test(e), "a round with 1.9M tokens of cache reads is not over the 2M per-round ceiling", e); }

// 5d. billing: a provider signed in with an API key is billed per token, and its rounds' dollars are shown; a
//     subscription shows no dollars; a provider whose sign-in Studio cannot tell shows nothing
{ const { noteBilling, billingOf, claudeBilling, codexBilling } = await import("../src/lan/billing") as any;
  ok(claudeBilling("api_key") === "per-token" && claudeBilling("claude.ai") === "subscription" && claudeBilling("oauth_token") === "subscription" && codexBilling("apiKey") === "per-token" && codexBilling("chatgpt") === "subscription" && billingOf("cursor") === null, "Claude and Codex sign-ins tell a per-token API key from a subscription; Cursor's cannot be told (nothing is shown for it)");
  noteBilling("claude", "per-token"); noteBilling("codex", "subscription");
  const L = ledgerAt(); const { P } = seams(L); const r = lanTask("R-bill", 9);
  await P.wrapRound(r, opts(r, { id: "claude", model: "m" }), async () => ({ id: "J-1", status: "done", cost: { usd: 0.42, inTokens: 100, outTokens: 10 } }));
  await P.wrapRound(r, opts(r, { id: "codex", model: "m" }), async () => ({ id: "J-2", status: "done", cost: { usd: 9.99, inTokens: 100, outTokens: 10 } }));
  const { spent } = await import("../src/lan/profile");
  ok(spent({}, r).usd === 0.42 && r.ctx.lanRounds[0].billing === "per-token" && !("usd" in r.ctx.lanRounds[1]), "a round billed per token keeps the dollars it reported (shown); a subscription round keeps none", JSON.stringify([spent({}, r), r.ctx.lanRounds]));
  noteBilling("claude", null); noteBilling("codex", null); }

// 6. a job's tokens add up over every usage report of the job, never just the last
{ const A = new Agents(mkdtempSync(join(tmpdir(), "crew-agent-cost-")), () => "http://127.0.0.1:1");
  const provider: any = { id: "fake", model: "m", start: () => ({ async *send() { yield { type: "usage", usage: { usd: null, inTokens: 100, outTokens: 10 } }; yield { type: "usage", usage: { usd: null, inTokens: 200, outTokens: 20 } }; yield { type: "turnEnd", status: "ok", usage: { usd: null, inTokens: 300, outTokens: 30 } }; }, interrupt() {} }) };
  const j = await A.run({ kind: "test", title: "t", system: "", text: "x", tools: [], provider, queueLease: true } as any);
  ok(j.status === "done" && j.cost?.inTokens === 600 && j.cost?.outTokens === 60, "a job's token counts add up over its usage reports (never overwritten by the last)", JSON.stringify(j.cost)); }

// 7. the opt-in auto-start: only when ticked at the take, and only if every check still holds when the assignment arrives
const starts: string[] = [], cancelled: string[] = [];
const runner = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Documents", defHash: "a".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
  start: async () => { const id = `R-${starts.length + 1}`; starts.push(id); return { run: id, workflow: { id: "documents", version: 1, defHash: "a".repeat(64) } }; },
  status: (id) => ({ state: cancelled.includes(id) ? "cancelled" : "running", result: null, spent: { rounds: 1, tokens: 1200, minutes: 2 }, stopped: null }), output: async () => { throw new Error("no"); }, cancel: (id) => { cancelled.push(id); } });
let daily: string | null = null;
// this suite opens many threads and starts many Tasks between two Studios: the open-dispatch and concurrency bounds
// (tests/lan-limits.ts) are lifted here
(LIMITS as any).openPerPeer = 100; (LIMITS as any).concurrentTasks = 100;
const LB = ledgerAt();
const mk = (n: string, spend?: SpendLedger) => Lan.open({ dataDir: mkdtempSync(join(tmpdir(), `crew-lan-spend-${n}-`)), runner: runner(), bind: "127.0.0.1", port: 0, dailyRefusal: () => daily, ...(spend ? { spend } : {}) } as any);
const A = await mk("a"), B = await mk("b", LB); A.setEnabled(true); B.setEnabled(true);
{ B.openIntro(1); const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0]; await A.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A"); }
async function round(auto: boolean, tweak?: (r: any) => void, provider: string | null = null) {
  const t = await A.dispatch({ to: B.id.key, title: "t", briefing: `note ${Math.random()}` }); await A.flush(); await until(() => B.view().items.some((i: any) => i.thread === t.id));
  const d = B.view().items.find((i: any) => i.thread === t.id)!, th = B.thread(t.id)!;
  await B.approve(d.id, { workflow: "documents", seen: B.seenHash(th, th.rounds[0]), rounds: 3, autoStart: auto, provider }); tweak?.(th.rounds[0]); await B.flush();
  await until(() => A.view().items.some((i: any) => i.kind === "take" && i.thread === t.id)); await A.approve(A.view().items.find((i: any) => i.kind === "take" && i.thread === t.id)!.id); await A.flush();
  await until(() => B.view().items.some((i: any) => i.kind === "assign" && i.thread === t.id)); await Bun.sleep(300);
  return t.id;
}
{ const n0 = starts.length, id = await round(false);
  ok(starts.length === n0 && B.view().items.some((i: any) => i.kind === "assign" && i.thread === id && i.state === "open"), "without the opt-in, an assigned round waits for the taker's start click");
  const item = B.view().items.find((i: any) => i.kind === "assign" && i.thread === id)!;
  ok(/^[0-9a-f]{16}/.test(item.promptHash ?? "") && JSON.stringify(item.cap) === JSON.stringify({ rounds: 3 }), "the start click shows what it starts: the prompt's hash, the cap (rounds only), the project", JSON.stringify([item.promptHash, item.cap, item.project])); }
{ const n0 = starts.length, id = await round(true); await until(() => starts.length > n0);
  const rr = B.thread(id)!.rounds[0].run;
  ok(starts.length === n0 + 1 && rr?.auto === true && B.auditView().rows.some((x) => x.what === "auto-start") && B.auditView().rows.some((x) => x.what === "take" && x.data.autoStart === true), "opted in at the take, the assigned round starts by itself: marked so on the thread (a notice) and audited", JSON.stringify(rr));
  await until(() => !!B.thread(id)!.rounds[0].run?.spent);
  ok(JSON.stringify(B.thread(id)!.rounds[0].run?.spent) === JSON.stringify({ rounds: 1, tokens: 1200, minutes: 2 }), "the thread shows what the Task used: rounds, tokens and agent-minutes, no dollars", JSON.stringify(B.thread(id)!.rounds[0].run?.spent));
  B.stopRun(id); ok(cancelled.includes(rr!.id) && B.thread(id)!.rounds[0].run!.state === "cancelled", "one click stops the Task"); }
{ const n0 = starts.length, id = await round(true, (r) => { r.take.auto.until = Date.now() - 1; });
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /expired/.test(String(x.data.why))), "an opt-in that expired (30 minutes after the take) starts nothing; the skip is audited", String(id)); }
{ const n0 = starts.length; await round(true, (r) => { r.take.auto.seen = "0".repeat(64); });
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /prompt/.test(String(x.data.why))), "if the prompt is not the one the taker read, nothing starts by itself"); }
{ const n0 = starts.length; daily = "daily ceiling: test"; await round(true); daily = null;
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /daily ceiling/.test(String(x.data.why))), "past a daily ceiling, nothing starts by itself"); }
// a provider paused by its subscription limit: no take on it, no auto-start on it, until the captain resumes it (audited)
{ LB.pause("codex", "rate limit reached, try again in 20 minutes", "R-x", "2026-11-03T12:00:00.000Z"); B.noteLimit("R-x", "codex", "rate limit reached");
  ok(B.view().paused.some((p: any) => p.provider === "codex" && p.resets === "2026-11-03T12:00:00.000Z") && "billing" in B.view(), "the Peers page gets the pause with the reset time the provider gave, and how each provider's sign-in is billed", JSON.stringify([B.view().paused, (B.view() as any).billing]));
  const t = await A.dispatch({ to: B.id.key, title: "t", briefing: `paused ${Math.random()}` }); await A.flush(); await until(() => B.view().items.some((i: any) => i.thread === t.id));
  const d = B.view().items.find((i: any) => i.thread === t.id)!, th = B.thread(t.id)!; let e = "";
  try { await B.approve(d.id, { workflow: "documents", seen: B.seenHash(th, th.rounds[0]), rounds: 3, provider: "codex" }); } catch (x: any) { e = `${x.code}: ${x.message}`; }
  ok(/^paused: .*codex.*subscription limit/.test(e) && B.view().paused.some((p: any) => p.provider === "codex") && B.auditView().rows.some((x) => x.what === "provider-paused" && x.data.provider === "codex"), "a provider paused by its subscription limit takes no peer work (the page lists it; the pause is audited)", e);
  const n0 = starts.length; await round(true, (r) => { r.take.provider = "codex"; });
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /paused/.test(String(x.data.why))), "nothing starts by itself on a paused provider");
  B.resumeProvider("codex");
  ok(!B.view().paused.length && B.auditView().rows.some((x) => x.what === "provider-resumed" && x.data.provider === "codex"), "the captain resumes the provider on the Peers page (audited)");
  await B.approve(d.id, { workflow: "documents", seen: B.seenHash(th, th.rounds[0]), rounds: 3, provider: "codex" });
  ok(B.thread(t.id)!.rounds[0].take?.provider === "codex", "once resumed, the provider takes peer work again"); }
{ // the checks made when the assignment arrives: a waiting assignment, an opt-in written in, then a frozen peer, then not
  const id = await round(false), item = B.view().items.find((i: any) => i.kind === "assign" && i.thread === id)!, r = B.thread(id)!.rounds[0], n0 = starts.length;
  r.take!.auto = { until: Date.now() + 60_000, seen: B.seenHash(B.thread(id)!, r), at: now() };
  (B as any).peer(A.id.key).frozen = { at: "x", seq: 1, entries: ["a", "b"], why: "test" };
  const why = await B.autoStart(item.id); (B as any).peer(A.id.key).frozen = null;
  ok(/frozen/.test(String(why)) && starts.length === n0, "a frozen peer's assignment starts nothing by itself", String(why));
  r.take!.auto = { until: Date.now() + 60_000, seen: B.seenHash(B.thread(id)!, r), at: now() };
  const ok2 = await B.autoStart(item.id);
  ok(ok2 === null && starts.length === n0 + 1, "with every check holding, the same assignment starts by itself", String(ok2)); }
{ // an assignment without an opt-in is never started by itself, even when asked
  const id = await round(false), item = B.view().items.find((i: any) => i.kind === "assign" && i.thread === id)!, n0 = starts.length;
  const why = await B.autoStart(item.id); ok(why === "no opt-in" && starts.length === n0, "an assignment the taker did not opt in for is never started by itself", String(why)); }
A.close(); B.close();
console.log(`\nlan-spend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
