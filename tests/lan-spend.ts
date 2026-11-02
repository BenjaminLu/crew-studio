import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// What work from a peer may spend (docs/units/lan-relay.md, Spend): every paid round is at most 15 minutes and 60 tool
// calls, a round over the token ceiling ends the Task's paid rounds, the Studio-wide daily ceilings count every peer's
// Task (unknown-cost rounds at the estimate, against the dollar ceiling and the round ceiling), and the taker's opt-in
// auto-start starts an assigned round only when every check still holds, with a notice and a stop button.
//                                                                                                 bun tests/lan-spend.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capRefusal, dailyRefusal, installLanProfile, LAN_ROUND, DEFAULT_CEILINGS } from "../src/lan/profile";
import { Lan, type LanRunner } from "../src/lan/relay";

process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await Bun.sleep(25); } return true; };
const now = () => new Date().toISOString();
const lanTask = (id: string, usd: number | null, rounds: number, lanRounds: any[] = []) => ({ id, params: {}, nodes: {}, ctx: { lanRounds }, profile: { name: "lan", mark: { item: id, usd, rounds } } });

// 1. the per-round ceilings: whatever the mode asks for, a round of a peer's Task gets at most 15 minutes and 60 tool calls
{ let ceil = DEFAULT_CEILINGS; const runs: any[] = [];
  const e: any = { profiles: {}, commit: () => {}, list: () => runs }; installLanProfile(e, { ceilings: () => ceil }); const P = e.profiles.lan;
  const r = lanTask("R-1", null, 9); runs.push(r); let seen: any = null;
  await P.wrapRound(r, { ref: r.id, sandbox: { writes: [] }, tools: [], timeoutMs: 3 * 3600_000, maxTools: 400 }, async (o: any) => { seen = o; return { id: "J-1", status: "done", cost: { usd: null, inTokens: 3_000_000, outTokens: 10 } }; });
  ok(seen?.timeoutMs === LAN_ROUND.timeoutMs && seen?.maxTools === LAN_ROUND.maxTools, "a peer's round gets at most 15 minutes and 60 tool calls, whatever its mode asked for", JSON.stringify([seen?.timeoutMs, seen?.maxTools]));
  // 2. a round that reported more tokens than the ceiling ends the Task's paid rounds
  let e2 = ""; try { await P.wrapRound(r, { ref: r.id, sandbox: { writes: [] }, tools: [] }, async () => ({ id: "J-2", status: "done" })); } catch (x: any) { e2 = String(x?.message); }
  ok(/over the per-round ceiling/.test(e2) && r.ctx.lanRounds[0].tokens === 3_000_010, "a round over the per-round token ceiling stops the next one", e2);
  // 3. the daily ceilings over every peer's Task: rounds, dollars, and unknown-cost rounds at the estimate
  runs.length = 0; const at = now();
  runs.push(lanTask("R-a", 5, 9, [{ n: 1, at, job: "j", usd: 3, ended: true }, { n: 2, at, job: "j", usd: null, ended: true }]), lanTask("R-b", null, 9, [{ n: 1, at, job: "j", usd: null, ended: true }]));
  ok(dailyRefusal(e, { dailyUsd: 10, dailyRounds: 60, unknownRoundUsd: 1 }) === null, "under the daily ceilings nothing is refused ($3 reported and two unknown rounds at $1 = $5 of $10)");
  ok(/daily ceiling: .*\$3\.00 today and 2 round\(s\) of unknown cost/.test(dailyRefusal(e, { dailyUsd: 5, dailyRounds: 60, unknownRoundUsd: 1 }) ?? ""), "unknown-cost rounds count against the dollar ceiling at the estimate, across every peer's Task (rounds-only ones included)", String(dailyRefusal(e, { dailyUsd: 5, dailyRounds: 60, unknownRoundUsd: 1 })));
  ok(/ran 3 paid round/.test(dailyRefusal(e, { dailyUsd: null, dailyRounds: 3, unknownRoundUsd: 1 }) ?? ""), "the daily round ceiling counts every peer's Task, even with the dollar ceiling off");
  ceil = { dailyUsd: null, dailyRounds: 3, unknownRoundUsd: 1 }; const r3 = lanTask("R-c", null, 9); runs.push(r3);
  let e3 = ""; try { await P.wrapRound(r3, { ref: r3.id, sandbox: { writes: [] }, tools: [] }, async () => ({ id: "J-3", status: "done" })); } catch (x: any) { e3 = String(x?.message); }
  ok(/daily ceiling/.test(e3) && !r3.ctx.lanRounds.length, "a round past a daily ceiling is refused before it starts (rounds-only items included)", e3); void capRefusal; }

// 4. the opt-in auto-start: only when ticked at the take, and only if every check still holds when the assignment arrives
const starts: string[] = [], cancelled: string[] = [];
const runner = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Documents", defHash: "a".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
  start: async () => { const id = `R-${starts.length + 1}`; starts.push(id); return { run: id, workflow: { id: "documents", version: 1, defHash: "a".repeat(64) } }; },
  status: (id) => ({ state: cancelled.includes(id) ? "cancelled" : "running", result: null, spent: { usd: 0.25, rounds: 1 }, stopped: null }), output: async () => { throw new Error("no"); }, cancel: (id) => { cancelled.push(id); } });
let daily: string | null = null;
const mk = (n: string) => Lan.open({ dataDir: mkdtempSync(join(tmpdir(), `crew-lan-spend-${n}-`)), runner: runner(), bind: "127.0.0.1", port: 0, dailyRefusal: () => daily });
const A = await mk("a"), B = await mk("b"); A.setEnabled(true); B.setEnabled(true);
{ B.openIntro(1); const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0]; await A.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A"); }
async function round(auto: boolean, tweak?: (r: any) => void) {
  const t = await A.dispatch({ to: B.id.key, title: "t", briefing: `note ${Math.random()}` }); await A.flush(); await until(() => B.view().items.some((i: any) => i.thread === t.id));
  const d = B.view().items.find((i: any) => i.thread === t.id)!, th = B.thread(t.id)!;
  await B.approve(d.id, { workflow: "documents", seen: B.seenHash(th, th.rounds[0]), roundsOnly: true, rounds: 3, autoStart: auto }); tweak?.(th.rounds[0]); await B.flush();
  await until(() => A.view().items.some((i: any) => i.kind === "take" && i.thread === t.id)); await A.approve(A.view().items.find((i: any) => i.kind === "take" && i.thread === t.id)!.id); await A.flush();
  await until(() => B.view().items.some((i: any) => i.kind === "assign" && i.thread === t.id)); await Bun.sleep(300);
  return t.id;
}
{ const n0 = starts.length, id = await round(false);
  ok(starts.length === n0 && B.view().items.some((i: any) => i.kind === "assign" && i.thread === id && i.state === "open"), "without the opt-in, an assigned round waits for the taker's start click");
  const item = B.view().items.find((i: any) => i.kind === "assign" && i.thread === id)!;
  ok(/^[0-9a-f]{16}/.test(item.promptHash ?? "") && item.cap?.rounds === 3 && item.cap?.usd === null, "the start click shows what it starts: the prompt's hash, the cap, the project", JSON.stringify([item.promptHash, item.cap, item.project])); }
{ const n0 = starts.length, id = await round(true); await until(() => starts.length > n0);
  const rr = B.thread(id)!.rounds[0].run;
  ok(starts.length === n0 + 1 && rr?.auto === true && B.auditView().rows.some((x) => x.what === "auto-start") && B.auditView().rows.some((x) => x.what === "take" && x.data.autoStart === true), "opted in at the take, the assigned round starts by itself: marked so on the thread (a notice) and audited", JSON.stringify(rr));
  // one click stops it
  B.stopRun(id); ok(cancelled.includes(rr!.id) && B.thread(id)!.rounds[0].run!.state === "cancelled", "one click stops the Task"); }
{ const n0 = starts.length, id = await round(true, (r) => { r.take.auto.until = Date.now() - 1; });
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /expired/.test(String(x.data.why))), "an opt-in that expired (30 minutes after the take) starts nothing; the skip is audited", String(id)); }
{ const n0 = starts.length; await round(true, (r) => { r.take.auto.seen = "0".repeat(64); });
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /prompt/.test(String(x.data.why))), "if the prompt is not the one the taker read, nothing starts by itself"); }
{ const n0 = starts.length; daily = "daily ceiling: test"; await round(true); daily = null;
  ok(starts.length === n0 && B.auditView().rows.some((x) => x.what === "auto-start-skipped" && /daily ceiling/.test(String(x.data.why))), "past a daily ceiling, nothing starts by itself"); }
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
