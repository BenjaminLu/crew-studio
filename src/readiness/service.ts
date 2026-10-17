// The readiness gate as a service: runs stages 1-4 for a draft revision or a workflow version,
// stores each result bound to the definition's hash (any edit invalidates it), drives the
// repair loop with Firstmate, and owns stage 5 (one real Task the captain asks for).
//
// Repair loop (captain rules, 2026-10-16): a failing gate sends Firstmate a repair turn with the
// typed problems; Firstmate revises the draft; the gate re-runs. After two rounds without progress
// Firstmate redrafts the failing part from scratch; at most six rounds in all. If it still fails,
// the draft stays "Not verified" with a plain status line listing what is left: a notice, never a
// question or a card. Problems only the captain can resolve are notices too and are never looped.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WDef } from "../runtime/defs";
import { briefStage, contractStage, gateHash, intentStage, type ContractEnv, type IntentLine, type LoginState, type Sample } from "./stages";
import { firstFailing, gatePassed, problemKey, P, type GateProblem, type GateResult, type L2, type RenderedBrief, type StageResult } from "./types";
import type { DryRunResult } from "./dryrun";

export type GateDeps = {
  dataDir: string;
  contract: (def: WDef, sample: Sample, logins?: Record<string, LoginState>) => ContractEnv;
  /** login state per provider, read once per gate run (never per node, never a sign-in) */
  logins?: () => Promise<Record<string, LoginState>> | Record<string, LoginState>;
  briefs: (def: WDef, sample: Sample) => (RenderedBrief & { roleText: string; skills: { id: string; body: string }[]; error: string | null })[];
  dry: (def: WDef, sample: Sample) => Promise<DryRunResult>;
  /** send Firstmate a turn (the repair prompt) carrying the repair ref as a field of the queued item; false when Firstmate is not in Studio */
  ask?: (text: string, repair: { draft: string; nonce: string }) => boolean;
  /** the repair round cap (setting readiness.repair_rounds, default 6) */
  maxRounds?: () => number;
  notify?: (key: string) => void;
  now?: () => number;
};
export type RepairRound = { n: number; revision: number; hash: string; strategy: "patch" | "redraft"; problems: GateProblem[]; changes: string[] | null; at: string; refused?: string | null };
export type RepairState = { schema: 1; draft: string; status: "idle" | "repairing" | "passed" | "not-verified" | "waiting-captain"; strategy: "patch" | "redraft"; rounds: RepairRound[]; nonce: string | null; pendingSince: number | null;
  /** the plain status line: what is left, or what only the captain can do (no options, no question) */
  notice: L2 | null; captain: GateProblem[]; smokeFed: string[] };

export const sampleOf = (def: WDef, goal?: string | null): Sample => {
  const s = (def as any).sample ?? {}; const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(def.params ?? {})) if ((v as any)?.default !== undefined) params[k] = String((v as any).default);
  for (const [k, v] of Object.entries(s.params ?? {})) if (typeof v === "string") params[k] = v;
  return { text: String(s.text ?? goal ?? def.origin?.brief?.goal ?? def.name ?? "").trim() || def.name, params };
};

/** The dry-run stage's plain line: where it stopped, or why it did not run (in the captain's terms, never a raw start refusal). */
export const dryNote = (dry: Pick<DryRunResult, "status" | "stoppedAt" | "staffing" | "missing">): L2 | null =>
  dry.stoppedAt ? { en: `Stopped before ${dry.stoppedAt}: a one-way decision the captain makes.`, zh: `停在 ${dry.stoppedAt} 之前：這是只有船長能做的單向決定。` }
  : dry.status !== "skipped" ? null
  : dry.staffing === "staffing_incomplete" ? { en: "Not dry-run: staffing not yet chosen; the captain picks who works on each node at Run.", zh: "未試跑：尚未選擇人員配置；船長執行時選擇各節點由誰負責。" }
  : dry.staffing ? { en: "Not dry-run: it starts only after the captain approves its staffing.", zh: "未試跑：船長核准人員配置後才能開始。" }
  : { en: `Not dry-run: ${dry.missing?.join(", ")} run only on the live engine (the stub acceptance suite runs this workflow end to end).`, zh: `未試跑：${dry.missing?.join("、")} 只在正式引擎上執行（替身驗收測試會完整跑這個流程）。` };

export class Gate {
  readonly dir: string;
  private queue = new Map<string, Promise<GateResult>>();
  private want = new Map<string, { def: WDef; goal: string | null }>();
  constructor(readonly d: GateDeps) { this.dir = join(d.dataDir, "readiness"); mkdirSync(this.dir, { recursive: true }); }
  private file(key: string) { if (!/^(draft-d-[a-f0-9]{12}|wf-[a-z0-9][a-z0-9-]{0,40}-v\d+)$/.test(key)) throw new Error("bad gate key"); return join(this.dir, key + ".json"); }
  private writeJSON(f: string, v: unknown) { writeFileSync(f + ".tmp", JSON.stringify(v, null, 1)); renameSync(f + ".tmp", f); }
  /** The stored result for a key, only while it is bound to this exact definition. */
  read(key: string, def?: WDef | null): GateResult | null {
    try { const r = JSON.parse(readFileSync(this.file(key), "utf8")) as GateResult; if (def && r.hash !== gateHash(def)) return null; return r; } catch { return null; }
  }
  /** Stages 1-3 (cheap, synchronous) for any definition. */
  static(def: WDef, sample: Sample, logins: Record<string, LoginState> = {}) {
    // stage 1 checks a drafted workflow's intent lines; a starter or built-in workflow has none to check
    const drafted = def.origin?.source === "firstmate-draft" || !!(def as any).intents?.length;
    const intent = drafted ? intentStage(def) : []; const contract = contractStage(def, this.d.contract(def, sample, logins));
    const rendered = this.d.briefs(def, sample); const brief = briefStage(def, rendered, sample);
    const st = (id: StageResult["id"], ps: GateProblem[]): StageResult => ({ id, status: ps.some((p) => p.level === "error") ? "fail" : "pass", problems: ps });
    const first = drafted ? st("intent", intent) : { id: "intent" as const, status: "skipped" as const, problems: [], note: { en: "Not a drafted workflow: it has no intent lines to check.", zh: "不是起草的流程：沒有意圖條目要檢查。" } };
    return { stages: [first, st("contract", contract), st("brief", brief)], briefs: rendered.map(({ node, label, system, prompt, roundDir }) => ({ node, label, system: system.slice(0, 24000), prompt: prompt.slice(0, 12000), roundDir })) };
  }
  /** Run stages 1-4 for a definition under a key; one run per key at a time, the newest definition wins. */
  run(key: string, def: WDef, goal: string | null = null, force = false): Promise<GateResult> {
    this.want.set(key, { def, goal });
    const prev = this.queue.get(key) ?? Promise.resolve(null as any);
    const next = prev.catch(() => null).then(async () => {
      const w = this.want.get(key)!; const cur = this.read(key, w.def); if (!force && cur && cur.stages.every((s) => s.status !== "running")) return cur;
      return this.exec(key, w.def, w.goal);
    });
    this.queue.set(key, next); next.finally(() => { if (this.queue.get(key) === next) this.queue.delete(key); }).catch(() => {});
    return next;
  }
  private async exec(key: string, def: WDef, goal: string | null): Promise<GateResult> {
    const sample = sampleOf(def, goal); const t0 = Date.now(); const hash = gateHash(def);
    const prior = this.read(key);
    let logins: Record<string, LoginState> = {}; try { logins = await (this.d.logins?.() ?? {}); } catch {}
    const s = this.static(def, sample, logins);
    const firstmateBlocked = s.stages.some((x) => x.problems.some((p) => p.level === "error" && p.owner === "firstmate")) || s.stages.find((x) => x.id === "intent")!.status === "fail" || s.stages.find((x) => x.id === "brief")!.status === "fail";
    const r: GateResult = { schema: 1, key, hash, at: new Date().toISOString(), stages: [...s.stages, { id: "dryrun", status: firstmateBlocked ? "skipped" : "running", problems: [], note: firstmateBlocked ? { en: "Runs after stages 1-3 pass.", zh: "前三關通過後才試跑。" } : null }, { id: "smoke", status: "pending", problems: [] }], briefs: s.briefs, dry: null,
      smoke: prior?.hash === hash ? prior.smoke ?? null : null, verified: prior?.hash === hash ? prior.verified ?? null : null };
    r.stages[0].ms = r.stages[1].ms = r.stages[2].ms = Date.now() - t0;
    this.writeJSON(this.file(key), r); this.d.notify?.(key);
    if (!firstmateBlocked) {
      const t1 = Date.now(); let dry: DryRunResult;
      try { dry = await this.d.dry(def, sample); } catch (e: any) { dry = { status: "fail", problems: [P("dryrun", "dryrun-error", null, { en: `The dry run could not run: ${e?.message ?? e}`, zh: `試跑無法進行：${e?.message ?? e}` }, { en: "Retry the gate.", zh: "請重新檢查。" })], steps: [], runStatus: "error", stoppedAt: null }; }
      r.stages[3] = { id: "dryrun", status: dry.status, problems: dry.problems, ms: Date.now() - t1, note: dryNote(dry) };
      r.dry = { steps: dry.steps, status: dry.runStatus, stoppedAt: dry.stoppedAt };
    }
    if (r.verified) r.stages[4] = { id: "smoke", status: "pass", problems: [] };
    else if (r.smoke?.status === "failed") r.stages[4] = { id: "smoke", status: "fail", problems: [P("smoke", "smoke-failed", null, { en: `The real run ${r.smoke.task} failed: ${r.smoke.error ?? "no reason recorded"}`, zh: `真實試跑 ${r.smoke.task} 失敗：${r.smoke.error ?? "沒有記錄原因"}` }, { en: "Firstmate revises the draft from this failure.", zh: "Firstmate 依此失敗修改草稿。" })] };
    else if (r.smoke?.status === "running") r.stages[4] = { id: "smoke", status: "running", problems: [] };
    // a newer definition may have been asked for meanwhile: write only when this one is still the one wanted
    const w = this.want.get(key); if (!w || gateHash(w.def) === hash) { this.writeJSON(this.file(key), r); this.d.notify?.(key); }
    return r;
  }
  /** A saved workflow version inherits its draft's result when the definition is the same (same hash). */
  carry(fromKey: string, toKey: string, def: WDef) { const r = this.read(fromKey, def); if (r) this.writeJSON(this.file(toKey), { ...r, key: toKey }); return r; }
  status(r: GateResult | null): { verified: boolean; text: L2; stage: string | null } {
    if (!r) return { verified: false, text: { en: "Not verified yet: the gate has not run on this version.", zh: "尚未驗證：這個版本還沒有檢查。" }, stage: null };
    if (r.verified) { const d = r.verified.at.slice(0, 10); return { verified: true, text: { en: `Verified ${d}, Task ${r.verified.task}`, zh: `已驗證 ${d}，任務 ${r.verified.task}` }, stage: null }; }
    const f = firstFailing(r); const running = r.stages.find((s) => s.status === "running" && s.id !== "smoke");
    if (f) { const n = f.problems.filter((p) => p.level === "error").length; return { verified: false, text: { en: `Not verified yet: ${STAGE_EN[f.id]} fails (${n} problem${n === 1 ? "" : "s"}).`, zh: `尚未驗證：${STAGE_ZH[f.id]}未通過（${n} 個問題）。` }, stage: f.id }; }
    if (running) return { verified: false, text: { en: `Not verified yet: ${STAGE_EN[running.id]} is running.`, zh: `尚未驗證：${STAGE_ZH[running.id]}進行中。` }, stage: running.id };
    if (gatePassed(r)) return { verified: false, text: { en: "Not verified yet: stages 1-4 pass; a real run would verify it.", zh: "尚未驗證：前四關已通過；真實試跑後即完成驗證。" }, stage: "smoke" };
    return { verified: false, text: { en: "Not verified yet.", zh: "尚未驗證。" }, stage: null };
  }

  // ---------- stage 5: one real Task ----------
  smokeStarted(key: string, def: WDef, task: string) { const r = this.read(key, def); if (!r || !gatePassed(r)) throw new Error("Stages 1-4 must pass on this exact version before a real run / 前四關需在此版本通過才能真實試跑");
    r.smoke = { task, status: "running", startedAt: new Date().toISOString() }; r.stages[4] = { id: "smoke", status: "running", problems: [] }; this.writeJSON(this.file(key), r); this.d.notify?.(key); return r; }
  /** The real run ended: success marks the version verified; a failure is fed back to Firstmate once. */
  smokeEnded(key: string, def: WDef, task: string, ok: boolean, error: string | null) {
    const r = this.read(key, def); if (!r || r.smoke?.task !== task || r.smoke.status !== "running") return null;
    r.smoke = { ...r.smoke, status: ok ? "succeeded" : "failed", endedAt: new Date().toISOString(), error: ok ? null : error };
    if (ok) { r.verified = { at: new Date().toISOString(), task }; r.stages[4] = { id: "smoke", status: "pass", problems: [] }; }
    else r.stages[4] = { id: "smoke", status: "fail", problems: [P("smoke", "smoke-failed", null, { en: `The real run ${task} failed: ${error ?? "no reason recorded"}`, zh: `真實試跑 ${task} 失敗：${error ?? "沒有記錄原因"}` }, { en: "Firstmate revises the draft from this failure.", zh: "Firstmate 依此失敗修改草稿。" })] };
    this.writeJSON(this.file(key), r); this.d.notify?.(key); return r;
  }
  runningSmokes(): GateResult[] { return readdirSync(this.dir).filter((f) => f.endsWith(".json") && !f.startsWith("repair-")).map((f) => { try { return JSON.parse(readFileSync(join(this.dir, f), "utf8")); } catch { return null; } }).filter((r: any) => r?.smoke?.status === "running"); }

  // ---------- the repair loop ----------
  private rfile(draft: string) { if (!/^d-[a-f0-9]{12}$/.test(draft)) throw new Error("bad draft id"); return join(this.dir, `repair-${draft}.json`); }
  repair(draft: string): RepairState { try { return JSON.parse(readFileSync(this.rfile(draft), "utf8")); } catch { return { schema: 1, draft, status: "idle", strategy: "patch", rounds: [], nonce: null, pendingSince: null, notice: null, captain: [], smokeFed: [] }; } }
  private saveRepair(s: RepairState) { this.writeJSON(this.rfile(s.draft), s); this.d.notify?.("draft-" + s.draft); return s; }
  /** What pages and Firstmate read: the loop's state without its one-time code. */
  repairView(draft: string) { const { nonce, ...rest } = this.repair(draft); void nonce; return rest; }
  /** A repair turn may revise this draft only while the queued Studio item it came from carries the current one-time code. */
  repairAuthorized(draft: string, ref: { draft?: unknown; nonce?: unknown } | null | undefined) { const s = this.repair(draft); return !!s.nonce && !!ref && ref.draft === draft && ref.nonce === s.nonce; }
  repairing(): string[] { return readdirSync(this.dir).map((f) => /^repair-(d-[a-f0-9]{12})\.json$/.exec(f)?.[1]).filter((id): id is string => !!id && this.repair(id).status === "repairing"); }
  /** After a gate result on a draft revision: decide the next loop step. via: who wrote the revision. */
  afterGate(draft: string, revision: number, def: WDef, r: GateResult, via: "model" | "repair" | "captain-edit", prevDef: WDef | null = null): RepairState {
    let s = this.repair(draft);
    if (via !== "repair") s = { ...s, status: "idle", strategy: "patch", rounds: [], nonce: null, pendingSince: null, notice: null, smokeFed: s.smokeFed ?? [] }; // a captain-driven revision starts a fresh loop
    const all = r.stages.flatMap((x) => x.problems);
    const captain = all.filter((p) => p.owner === "captain");
    const fixable = all.filter((p) => p.owner === "firstmate" && p.level === "error");
    if (via === "repair" && s.rounds.length && prevDef) s.rounds[s.rounds.length - 1].changes = describeChanges(prevDef, def);
    s.captain = captain;
    const captainLine = captain.length ? captainNotice(captain) : null;
    if (r.stages.some((x) => x.status === "running")) return this.saveRepair(s);
    if (!fixable.length) {
      s.status = gatePassed(r) ? "passed" : captain.some((p) => p.level === "error") ? "waiting-captain" : "passed"; s.nonce = null; s.pendingSince = null;
      s.notice = captainLine; return this.saveRepair(s);
    }
    const cap = Math.max(1, this.d.maxRounds?.() ?? 6);
    if (s.rounds.length >= cap) { s.status = "not-verified"; s.nonce = null; s.pendingSince = null;
      s.notice = { en: `Not verified after ${s.rounds.length} repair rounds. Still open: ${fixable.map((p) => `${p.node ? p.node + ": " : ""}${p.reason.en}`).join(" · ")}${captainLine ? ` · ${captainLine.en}` : ""}`, zh: `修正 ${s.rounds.length} 輪後仍未通過驗證。尚待處理：${fixable.map((p) => `${p.node ? p.node + "：" : ""}${p.reason.zh}`).join("・")}${captainLine ? `・${captainLine.zh}` : ""}` };
      return this.saveRepair(s); }
    const keys = fixable.map(problemKey).sort().join("\n"); const hash = gateHash(def);
    const same = (a?: RepairRound, b?: { keys: string; hash: string }) => !!a && !!b && (a.problems.map(problemKey).sort().join("\n") === b.keys || a.hash === b.hash);
    // no progress: this result repeats the last round's problems (or the draft did not change); two such rounds switch strategy
    let streak = 0; { let cur = { keys, hash }; for (let i = s.rounds.length - 1; i >= 0; i--) { if (same(s.rounds[i], cur)) { streak++; cur = { keys: s.rounds[i].problems.map(problemKey).sort().join("\n"), hash: s.rounds[i].hash }; } else break; } }
    if (streak >= 2) s.strategy = "redraft";
    const nonce = randomBytes(6).toString("hex");
    s.rounds.push({ n: s.rounds.length + 1, revision, hash, strategy: s.strategy, problems: fixable, changes: null, at: new Date().toISOString() });
    s.status = "repairing"; s.nonce = nonce; s.pendingSince = this.d.now?.() ?? Date.now(); s.notice = captainLine;
    this.saveRepair(s);
    const sent = this.d.ask?.(repairPrompt(draft, s, fixable, (def as any).intents ?? []), { draft, nonce }) ?? false;
    if (!sent) { s.status = "idle"; s.nonce = null; s.notice = { en: `Firstmate is not running, so the draft was not repaired yet. Open: ${fixable.length} problem(s).`, zh: `Firstmate 未在執行，草稿尚未修正。待處理：${fixable.length} 個問題。` }; this.saveRepair(s); }
    return s;
  }
  /** A repair revision the gate refused (it weakened the gate): counts as a round without progress, Firstmate is told why. */
  refused(draft: string, reason: string, def: WDef) {
    const s = this.repair(draft); if (s.status !== "repairing") return s;
    const last = s.rounds.at(-1); if (last) last.refused = reason;
    const r = this.read("draft-" + draft); if (!r) return this.saveRepair(s);
    this.saveRepair(s); return this.afterGate(draft, last?.revision ?? 0, def, r, "repair", null);
  }
  /** A repair turn that never brought a revision (Firstmate's turn ended without one): count it as a round without progress. */
  tick(draft: string, def: WDef, waitMs = 10 * 60_000) { const s = this.repair(draft); const now = this.d.now?.() ?? Date.now(); if (s.status === "repairing" && s.pendingSince && now - s.pendingSince > waitMs) return this.refused(draft, "no revision arrived", def); return s; }
  /** A real run failed: feed it back once per definition hash. */
  feedSmoke(draft: string, def: WDef, r: GateResult, revision = 0) {
    const s = this.repair(draft); const h = r.hash; if ((s.smokeFed ?? []).includes(h)) return null;
    s.smokeFed = [...(s.smokeFed ?? []), h]; s.rounds = []; s.strategy = "patch"; this.saveRepair(s);
    return this.afterGate(draft, revision, def, r, "repair", null);
  }
}
const STAGE_EN: Record<string, string> = { intent: "stage 1 (intent lines)", contract: "stage 2 (static contract)", brief: "stage 3 (briefs)", dryrun: "stage 4 (stub dry run)", smoke: "stage 5 (real run)" };
const STAGE_ZH: Record<string, string> = { intent: "第 1 關（意圖）", contract: "第 2 關（靜態契約）", brief: "第 3 關（簡報）", dryrun: "第 4 關（替身試跑）", smoke: "第 5 關（真實試跑）" };
const NEED: Record<string, L2> = { "sign-in": { en: "Sign in to the provider", zh: "登入供應商" }, egress: { en: "Allow network access", zh: "允許網路連線" }, staffing: { en: "Choose who works on it at Run", zh: "執行時選擇負責的人" }, "one-way": { en: "Make the one-way decision", zh: "做出單向決定" } };
/** The captain's part, in plain lines: what to do and why. Firstmate never does these itself. */
function captainNotice(ps: GateProblem[]): L2 {
  const en = [...new Set(ps.map((p) => p.note?.en ?? `${NEED[p.need ?? ""]?.en ?? "Your decision"}: ${p.reason.en}`))], zh = [...new Set(ps.map((p) => p.note?.zh ?? `${NEED[p.need ?? ""]?.zh ?? "你的決定"}：${p.reason.zh}`))];
  return { en: en.join(" "), zh: zh.join("") };
}
export function describeChanges(a: WDef, b: WDef): string[] {
  const out: string[] = []; const an = new Map(a.nodes.map((n) => [n.id, n])), bn = new Map(b.nodes.map((n) => [n.id, n]));
  for (const id of bn.keys()) if (!an.has(id)) out.push(`added node ${id}`);
  for (const id of an.keys()) if (!bn.has(id)) out.push(`removed node ${id}`);
  for (const [id, n] of bn) { const o = an.get(id); if (!o) continue; const f = Object.keys({ ...o, ...n }).filter((k) => !["x", "y"].includes(k) && JSON.stringify((o as any)[k] ?? null) !== JSON.stringify((n as any)[k] ?? null)); if (f.length) out.push(`changed ${id}: ${f.join(", ")}`); }
  const ek = (e: any) => `${e.from}→${e.to}${e.when ? `[${e.when}]` : ""}`; const ae = new Set(a.edges.map(ek)), be = new Set(b.edges.map(ek));
  for (const e of be) if (!ae.has(e)) out.push(`added edge ${e}`); for (const e of ae) if (!be.has(e)) out.push(`removed edge ${e}`);
  for (const k of ["params", "sample", "intents", "roles"]) if (JSON.stringify((a as any)[k] ?? null) !== JSON.stringify((b as any)[k] ?? null)) out.push(`changed ${k}`);
  return out.length ? out : ["no change"];
}
export function repairPrompt(draft: string, s: RepairState, ps: GateProblem[], intents: IntentLine[]): string {
  const lines = ps.map((p, i) => `${i + 1}. [stage ${p.stage}${p.node ? `, node ${p.node}` : ""}] ${p.reason.en}\n   Fix: ${p.fix.en}`);
  return [`GATE-REPAIR ${draft}`,
    `The readiness gate failed on your workflow draft ${draft} (repair round ${s.rounds.length}${s.strategy === "redraft" ? ", strategy: REDRAFT" : ""}). Revise it now with studio_draft_workflow, passing draft: "${draft}" and the full revised workflow. Do not ask the captain anything.`,
    s.strategy === "redraft" ? "Two rounds made no progress. Do not patch again: redraft the failing part from scratch (or the whole workflow if the failures spread), using the problem list below." : "Fix every problem below in one revision.",
    "Problems:", ...lines,
    "Keep the goal, the interview answers and every captain card (each decision card and its options) as they are.",
    `Keep every intent line the captain gave, word for word (${intents.map((l) => l.n).join(", ") || "none yet"}). If a line is ambiguous, pick the most reasonable reading and write it as that line's "assumption"; do not ask. Never drop a one-way captain card before an external effect, never widen a node's folders outside its round folder, never remove or weaken checks: the gate refuses such revisions.`,
    "Problems only the captain can resolve (a sign-in, an egress grant, staffing approval, a one-way decision) are not yours to fix; never start a sign-in or grant a permission.",
    "Studio re-runs the gate on your revision and tells you the result. / 閘門會重新檢查你的修改。"].join("\n");
}

/** A repair revision that weakens the gate is refused. Returns the reason, or null when the revision is fair.
 *  saved: when the draft is already a saved workflow, its latest version (with the captain's editor changes) and its
 *  first version; nodes the captain added or changed in the editor may not be removed or rewritten by a repair. */
export function weakening(prev: WDef, next: WDef, contract?: (def: WDef) => GateProblem[], saved?: { latest: WDef; first: WDef | null } | null): string | null {
  const bases = [prev, ...(saved ? [saved.latest] : [])];
  for (const base of bases) {
    const pi: IntentLine[] = (base as any).intents ?? [], ni: IntentLine[] = (next as any).intents ?? [];
    for (const l of pi) { const m = ni.find((x) => x.n === l.n); if (!m || m.text.trim() !== l.text.trim() || m.done.trim() !== l.done.trim()) return `intent line ${l.n} must stay as the captain gave it ("${l.text}"); a repair may only add an assumption`; }
    // every captain card stays, with every option it offers: a repair never removes a decision the captain makes
    for (const c of base.nodes.filter((n) => n.kind === "card")) {
      const m = next.nodes.find((n) => n.id === c.id);
      if (!m || m.kind !== "card") return `the captain's card ${c.id} cannot be removed`;
      if (JSON.stringify(c.args ?? null) !== JSON.stringify(m.args ?? null) || !!c.card?.confirm_door !== !!m.card?.confirm_door) return `the captain's card ${c.id} cannot change what kind of decision it is`;
      const missing = (c.card?.options ?? []).filter((o) => !(m.card?.options ?? []).some((x) => x.id === o.id));
      if (missing.length) return `the captain's card ${c.id} must keep its option${missing.length > 1 ? "s" : ""} ${missing.map((o) => o.id).join(", ")}`;
    }
    for (const n of base.nodes) {
      const m = next.nodes.find((x) => x.id === n.id);
      const prevChecks = (n.checks ?? []).map((c) => c.use), nextChecks = (m?.checks ?? []).map((c) => c.use);
      if (prevChecks.some((c) => !nextChecks.includes(c)) || (n.checks ?? []).some((c) => c.blocking !== false && m?.checks?.find((x) => x.use === c.use)?.blocking === false)) return `the checks on ${n.id} cannot be removed or made non-blocking`;
      if (n.kind === "check" && !m) return `the check node ${n.id} cannot be removed`;
    }
    for (const e of base.edges) if (e.checks?.length) { const m = next.edges.find((x) => x.from === e.from && x.to === e.to && x.when === e.when); if (!m || e.checks.some((c) => !(m.checks ?? []).some((x) => x.use === c.use))) return `the checks on edge ${e.from}→${e.to} cannot be removed`; }
    if (JSON.stringify(base.policies ?? null) !== JSON.stringify(next.policies ?? null)) return "a repair cannot change the workflow's policies";
  }
  if (saved) {
    // what the captain changed in the editor after the first save stays: their added or edited nodes keep their label, kind, role and checks
    const first = new Map((saved.first?.nodes ?? []).map((n) => [n.id, n]));
    const FIELDS = ["kind", "label", "detail", "role", "mode", "provider", "model", "effort", "skill", "skills", "checks", "card", "args", "do"] as const;
    for (const n of saved.latest.nodes) {
      const o = first.get(n.id); const edited = !o || FIELDS.some((k) => JSON.stringify((o as any)[k] ?? null) !== JSON.stringify((n as any)[k] ?? null));
      if (!edited) continue;
      const m = next.nodes.find((x) => x.id === n.id);
      if (!m) return `${n.id} was added or edited by the captain in v${saved.latest.version} and cannot be removed by a repair`;
      const changed = FIELDS.filter((k) => !["provider", "model", "effort"].includes(k) && JSON.stringify((n as any)[k] ?? null) !== JSON.stringify((m as any)[k] ?? null));
      if (changed.length) return `${n.id} was edited by the captain in v${saved.latest.version}; a repair cannot change its ${changed.join(", ")}`;
    }
  }
  if (contract) { const before = new Set(contract(prev).filter((p) => p.code === "sandbox-path").map((p) => p.node)); const after = contract(next).filter((p) => p.code === "sandbox-path" && !before.has(p.node));
    if (after.length) return `node ${after[0].node} would work outside its round folder; a repair cannot widen a node's folders`; }
  return null;
}
export { gateHash };
export const gateKeyForWorkflow = (id: string, v: number) => `wf-${id}-v${v}`;
export const gateKeyForDraft = (id: string) => `draft-${id}`;
export const existsGate = (dir: string, key: string) => existsSync(join(dir, "readiness", key + ".json"));
