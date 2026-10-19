// Skill packages (docs/units/skill-packages.md): one service over the library for everything a script skill needs before
// and during a round. It answers "may this version's scripts run, and is it ready here?" for the approval card, the Crew page,
// Firstmate's work status and the round's dispatch, and it prepares a version (runtimes, programs, env) by itself once the
// captain approved it: no card, no question. A version's status is Studio's own record:
//   data/skillpkg/status/<id>@v<N>.json   {state, envKey, runtimes, bins, reasons, warnings, at}
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Skills } from "../skills";
import { filesHash } from "../skills";
import { proposedHosts, type PackageInfo } from "./analyze";
import { SkillApprovals, type Approval, type ScriptDecision } from "./approvals";
import { envDir, gcEnvs, prepareEnv, PrepareError, readEnv, type EnvRecord } from "./prepare";
import { resolveBin, toolDirs, type BinState, type ToolRecipe } from "./recipes";
import { resolveNode, resolvePython, type Runtime } from "./runtimes";

export type Reason = { en: string; zh: string };
export type SkillState = "markdown" | "needs-approval" | "text-only" | "preparing" | "ready" | "not-ready";
export type SkillStatus = { id: string; v: number; state: SkillState; scripts: number; hosts: string[]; decision: Approval | null; envKey: string | null; env: EnvRecord | null;
  runtimes: { node?: Runtime; python?: Runtime }; bins: BinState[];
  /** why it is not ready; blocking: the scripts cannot run at all (no approval, no env, no runtime), not only some of them */
  reasons: Reason[]; blocking: boolean; warnings: string[]; at: string | null };
type Egress = { port: number; open(t: string, h: string[], meta?: any): void; close(t: string): void };
export type PackagesOpts = { dataDir: string; skills: Skills; egress?: () => Egress | null; protect?: () => string[]; path?: string;
  /** Homebrew and uv: false never (tests, the manual smoke); a path; undefined to look for them */ brew?: false | string; uv?: false | string; clt?: () => boolean; recipes?: ToolRecipe[];
  /** "<id>@v<N>" of every library version the team or a workflow pins now (gc keeps their envs) */ inUse?: () => Set<string>; retryAfterMs?: number; log?: (line: string) => void };
const ref = (id: string, v: number) => `${id}@v${v}`;
/** A reason's head ("soffice missing", "preparing its dependencies failed"): the badge's few words; the full reason stays beside it. */
const short = (t: string, sep: string) => { const p = t.split(sep); return (/@v\d+$/.test(p[0]) ? p[1] ?? p[0] : p[0]).trim(); };

export class SkillPackages {
  readonly approvals: SkillApprovals;
  private running = new Map<string, Promise<SkillStatus>>();
  constructor(readonly o: PackagesOpts) { this.approvals = new SkillApprovals(o.dataDir); }
  private statusFile(id: string, v: number) { return join(this.o.dataDir, "skillpkg", "status", `${id}@v${v}.json`); }
  pkg(id: string, v: number): PackageInfo | null { return this.o.skills.pkg(id, v); }
  isScript(id: string, v: number) { return (this.pkg(id, v)?.scripts.length ?? 0) > 0; }
  /** The captain's decision in force for exactly this version (both hashes); null: none. */
  decision(id: string, v: number): Approval | null {
    const lv = this.o.skills.libVersion(id, v); if (!lv) return null;
    return this.approvals.current(id, v, lv.rec.sha256, lv.rec.filesSha256);
  }
  /** Validate the whole approval batch before any signed decision or team write. */
  assertDecidable(id: string, v: number, expected?: {sha256: string; filesSha256: string}) {
    const lv = this.o.skills.libVersion(id, v);
    if (!lv || expected && (lv.rec.sha256 !== expected.sha256 || lv.rec.filesSha256 !== expected.filesSha256)) throw new Error(`skill ${id}@v${v} is not the version shown`);
    if (!this.o.skills.filesIntact(id, v)) throw new Error(`skill ${id}@v${v} changed on disk since it was recorded; nothing approved`);
  }
  /** Record the captain's decision for a version: its proposed hosts are exactly what an approval allows. Then prepare it. */
  decide(id: string, v: number, scripts: ScriptDecision, by: string, via: string, extra: { card?: string; run?: string; installScripts?: string[] } = {}): Approval {
    const lv = this.o.skills.libVersion(id, v); if (!lv) throw new Error(`skill ${id} v${v} is not in the library`);
    this.assertDecidable(id, v);
    const pkg = this.pkg(id, v)!;
    const a = this.approvals.record(id, { v, sha256: lv.rec.sha256, filesSha256: lv.rec.filesSha256, scripts, hosts: scripts === "approved" ? proposedHosts(pkg) : [], installScripts: extra.installScripts ?? [], by, via, card: extra.card, run: extra.run });
    if (scripts === "approved") this.prepareSoon(id, v);
    return a;
  }
  /** What the approval card shows for one version: its scripts, flags, the hosts approving it allows, the programs and locks. */
  cardFacts(id: string, v: number) {
    const pkg = this.pkg(id, v); if (!pkg) return null;
    return { id, v, scripts: pkg.scripts.map((s) => ({ path: s.path, lang: s.lang, bytes: s.bytes, flags: s.flags })), hosts: proposedHosts(pkg), refusedHosts: pkg.hosts.refused,
      locks: [pkg.npm ? `npm (${pkg.npm.files[1]})` : null, pkg.python ? `python (${pkg.python.files[0]})` : null].filter(Boolean) as string[], bins: pkg.bins, warnings: pkg.warnings };
  }
  /** The last recorded status, refreshed for what may have changed since (a decision, a new version's files). */
  status(id: string, v: number): SkillStatus {
    const pkg = this.pkg(id, v);
    const base: SkillStatus = { id, v, state: "markdown", scripts: pkg?.scripts.length ?? 0, hosts: pkg ? proposedHosts(pkg) : [], decision: null, envKey: null, env: null, runtimes: {}, bins: [], reasons: [], blocking: false, warnings: pkg?.warnings ?? [], at: null };
    if (!pkg || !pkg.scripts.length) return base;
    const decision = this.decision(id, v); base.decision = decision;
    if (!decision) return { ...base, state: "needs-approval", blocking: true, reasons: [{ en: `${ref(id, v)} has ${pkg.scripts.length} script${pkg.scripts.length === 1 ? "" : "s"} and is not approved: the captain approves it on the team-change card (or chooses text only)`, zh: `${ref(id, v)} 有 ${pkg.scripts.length} 個 script，還沒核准：請在團隊變更卡上核准（或選「只當文字」）` }] };
    if (decision.scripts === "text-only") return { ...base, state: "text-only" };
    if (this.running.has(ref(id, v))) return { ...base, state: "preparing", reasons: [{ en: `${ref(id, v)} is being prepared`, zh: `${ref(id, v)} 準備中` }] };
    let saved: SkillStatus | null = null; try { saved = JSON.parse(readFileSync(this.statusFile(id, v), "utf8")); } catch {}
    if (!saved || saved.decision?.sig !== decision.sig) return { ...base, state: "preparing", reasons: [{ en: `${ref(id, v)} is approved and waits to be prepared`, zh: `${ref(id, v)} 已核准，等待準備` }] };
    // an env gc removed since: prepared again on the next ensure
    if (saved.envKey && !readEnv(this.o.dataDir, saved.envKey)) return { ...saved, decision, state: "preparing", reasons: [{ en: `${ref(id, v)}'s env is gone and will be prepared again`, zh: `${ref(id, v)} 的環境被清掉了，會重新準備` }] };
    return { ...saved, decision };
  }
  /** Prepare in the background (after an approval, at startup); the result lands in the status file. */
  prepareSoon(id: string, v: number) { void this.ensure(id, v).catch((e) => this.o.log?.(`skill ${ref(id, v)}: prepare: ${e?.message ?? e}`)); }
  /** The status once prepared: waits for a prepare in flight, starts one when the version is approved and was never prepared. */
  async ensure(id: string, v: number, signal?: AbortSignal, startup = false): Promise<SkillStatus> {
    const now = this.status(id, v), last = Date.parse(now.at ?? "");
    const retry = now.state === "not-ready" && now.decision?.scripts === "approved" &&
      (startup || !Number.isFinite(last) || Date.now() - last >= Math.max(0, this.o.retryAfterMs ?? 30_000));
    if (now.state !== "preparing" && !retry) return now;
    const k = ref(id, v); let p = this.running.get(k);
    if (!p) { p = this.prepare(id, v, signal).finally(() => this.running.delete(k)); this.running.set(k, p); }
    return p;
  }
  /** Resolve the runtimes and programs a version needs, then its env; record the outcome. */
  private async prepare(id: string, v: number, signal?: AbortSignal): Promise<SkillStatus> {
    const pkg = this.pkg(id, v)!, lv = this.o.skills.libVersion(id, v)!, decision = this.decision(id, v);
    const st: SkillStatus = { ...this.status(id, v), state: "ready", decision, reasons: [], blocking: false, bins: [], runtimes: {}, at: null };
    const egress = this.o.egress?.() ?? null, protect = this.o.protect?.() ?? [];
    const ctx = { dataDir: this.o.dataDir, protect, egress, path: this.o.path, clt: this.o.clt, signal };
    const block = (r: Reason) => { st.reasons.push(r); st.blocking = true; st.state = "not-ready"; };
    if (!this.o.skills.filesIntact(id, v)) block({ en: `${ref(id, v)} changed on disk since it was recorded`, zh: `${ref(id, v)} 在記錄之後被改過` });
    if (pkg.runtimes.includes("node")) { const n = resolveNode(ctx); if (n) st.runtimes.node = n; else block({ en: "node missing: no node on this Mac and Studio's own runtime is not bun", zh: "缺 node" }); }
    if (pkg.runtimes.includes("python")) { const p = await resolvePython({ ...ctx, uv: this.o.uv }); if ("rt" in p) st.runtimes.python = p.rt; else block(p.missing); }
    for (const b of pkg.bins) { const r = await resolveBin(b, { ...ctx, brew: this.o.brew, recipes: this.o.recipes }); st.bins.push(r);
      if (r.state === "missing") { st.reasons.push(r.reason ?? { en: `${b} missing`, zh: `缺 ${b}` }); if (st.state === "ready") st.state = "not-ready"; } }
    if ((pkg.npm || pkg.python) && !st.blocking) {
      try { const env = await prepareEnv(pkg, join(lv.dir, "files"), st.runtimes, ref(id, v), { ...ctx, allowScripts: decision?.installScripts ?? [] }); st.env = env; st.envKey = env.key;
        if (env.installScripts.length) st.warnings = [...st.warnings, `${env.installScripts.join(", ")} ship${env.installScripts.length === 1 ? "s" : ""} an install script, which did not run: a registry package's script is unreviewed code${env.ranScripts.length ? ` (ran, as approved: ${env.ranScripts.join(", ")})` : ""}`]; }
      catch (e: any) { block({ en: `${ref(id, v)}: preparing its dependencies failed: ${e?.message ?? e}`, zh: `${ref(id, v)}：準備依賴失敗：${e instanceof PrepareError ? e.zh : e?.message ?? e}` }); }
    }
    st.at = new Date().toISOString();
    mkdirSync(dirname(this.statusFile(id, v)), { recursive: true }); writeFileSync(this.statusFile(id, v), JSON.stringify(st, null, 1));
    this.o.log?.(`skill ${ref(id, v)}: ${st.state}${st.reasons.length ? ` (${st.reasons.map((r) => r.en).join("; ")})` : ""}`);
    return st;
  }
  /** Prepare every approved script version in use (Studio's start), then remove envs nothing in use names. */
  async prepareInUse(): Promise<void> {
    const used = this.o.inUse?.() ?? new Set<string>();
    for (const r of used) { const m = /^(.+)@v(\d+)$/.exec(r); if (m && this.isScript(m[1], Number(m[2])) && this.decision(m[1], Number(m[2]))?.scripts === "approved") await this.ensure(m[1], Number(m[2]), undefined, true).catch(() => {}); }
    this.gc();
  }
  gc(keepNewerThanMs = 0) { return gcEnvs(this.o.dataDir, this.o.inUse?.() ?? new Set(), keepNewerThanMs); }
  /** A short readiness line for the Crew page, the viewer and Firstmate (en and zh-TW). */
  badge(id: string, v: number): { state: SkillState; ready: boolean; en: string; zh: string; reasons: Reason[]; scripts: number; hosts: string[] } | null {
    const s = this.status(id, v); if (s.state === "markdown") return null;
    const head = { en: `${s.scripts} script${s.scripts === 1 ? "" : "s"}${s.hosts.length ? ` · reaches ${s.hosts.join(", ")}` : ""}`, zh: `含 ${s.scripts} 個 script${s.hosts.length ? ` · 會連 ${s.hosts.join("、")}` : ""}` };
    const word: Record<SkillState, Reason> = { markdown: { en: "", zh: "" }, "needs-approval": { en: "not approved", zh: "未核准" }, "text-only": { en: "text only", zh: "只當文字" }, preparing: { en: "preparing", zh: "準備中" }, ready: { en: "ready", zh: "可以用" },
      "not-ready": { en: `not ready: ${s.reasons.map((r) => short(r.en, ": ")).join("; ")}`, zh: `還不能用：${s.reasons.map((r) => short(r.zh, "：")).join("；")}` } };
    return { state: s.state, ready: s.state === "ready", en: `${head.en} · ${word[s.state].en}`, zh: `${head.zh} · ${word[s.state].zh}`, reasons: s.reasons, scripts: s.scripts, hosts: s.hosts };
  }
  /** Every script skill version in use with its readiness (Firstmate's work status): what is not ready and why, never a question. */
  inUseStatus(): { skill: string; state: SkillState; ready: boolean; en: string; zh: string; reasons: string[] }[] {
    const out: { skill: string; state: SkillState; ready: boolean; en: string; zh: string; reasons: string[] }[] = [];
    for (const r of [...(this.o.inUse?.() ?? [])].sort()) { const m = /^(.+)@v(\d+)$/.exec(r); if (!m) continue; let b; try { b = this.badge(m[1], Number(m[2])); } catch { continue; }
      if (b) out.push({ skill: r, state: b.state, ready: b.ready, en: b.en, zh: b.zh, reasons: b.reasons.map((x) => x.en) }); }
    return out;
  }
  /** Folders a skill_run reads and executes but never writes: its env, the runtimes' installs, Studio's fetched tools. */
  runReads(s: SkillStatus): string[] {
    return [s.envKey ? envDir(this.o.dataDir, s.envKey) : null, s.runtimes.node?.dir, s.runtimes.python?.dir, ...toolDirs(this.o.dataDir),
      ...s.bins.filter((b) => b.path && b.state !== "missing").map((b) => b.path!.includes(".app/") ? b.path!.slice(0, b.path!.indexOf(".app/") + 4) : dirname(b.path!))].filter((x): x is string => !!x);
  }
  /**
   * The round's copy of a version: SKILL.md and its files, byte for byte, read-only (files 0444, folders 0555), then hashed again;
   * a copy that does not hash to the version's record is removed and refused.
   */
  roundCopy(id: string, v: number, into: string): string {
    const lv = this.o.skills.libVersion(id, v); if (!lv) throw new Error(`skill ${id} v${v} is not in the library`);
    const dest = join(into, id); if (existsSync(dest)) { chmodTree(dest, true); rmSync(dest, { recursive: true, force: true }); }
    const stage = `${dest}.copy`; rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
    copyFileSync(join(lv.dir, "SKILL.md"), join(stage, "SKILL.md"));
    for (const f of lv.rec.files) { mkdirSync(dirname(join(stage, f)), { recursive: true }); copyFileSync(join(lv.dir, "files", f), join(stage, f)); }
    const ok = filesHash(stage, lv.rec.files) === lv.rec.filesSha256 && createSha(readFileSync(join(stage, "SKILL.md"))) === lv.rec.sha256;
    if (!ok) { rmSync(stage, { recursive: true, force: true }); throw new Error(`skill ${ref(id, v)}: its stored files do not hash to the recorded version; not delivered`); }
    renameSync(stage, dest); chmodTree(dest, false);
    return dest;
  }
}
const createSha = (b: Buffer) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
/** Read-only (or writable again, to remove it): files 0444, folders 0555. */
export function chmodTree(dir: string, writable: boolean) {
  const walk = (d: string) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) { if (writable) chmodSync(p, 0o755); walk(p); if (!writable) chmodSync(p, 0o555); } else if (n.isFile()) chmodSync(p, writable ? 0o644 : 0o444); } };
  try { if (writable) chmodSync(dir, 0o755); walk(dir); if (!writable) chmodSync(dir, 0o555); } catch {}
}
export { proposedHosts };
