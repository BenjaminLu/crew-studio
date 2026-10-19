// A round's script skills (docs/units/skill-packages.md §3, §5, §8), decided before the agent starts:
//   - a pinned version whose files differ from its pin is refused;
//   - a script skill the captain never approved blocks the round (blocked, with the reason): a skill whose text tells the
//     agent to run scripts, delivered as text alone, makes the agent improvise replacements; text only is the captain's choice;
//   - an approved one is prepared (waited for), copied read-only into the round's folder and hashed again, and gets
//     skill_files / skill_read / skill_run; a version that cannot run at all (no env, no runtime) blocks the round too;
//     a missing program (soffice …) does not: the agent is told what is missing and the steps needing it fail.
// Every skill_run is recorded on the step (rn.data.skillRuns), in the evidence ledger (skill-run), and a host it was
// refused lands in the Task's context (ctx.skillRefusals) for Firstmate's work status. Nobody is asked during a run.
import { RoundBlocked } from "../round-blocked";
import { skillFooter, skillTools, type RoundSkill, type SkillRunRecord } from "./run";
import type { SkillPackages } from "./index";

export type SkillRound = { skills: RoundSkill[]; textOnly: { id: string; v: number }[]; root: string | null };
type Pin = { id: string; v: number; sha256: string; filesSha256?: string };

export async function skillGate(engine: any, x: any): Promise<SkillRound | null> {
  const pk: SkillPackages | null = engine.deps.skillPackages ?? null; if (!pk) return null;
  const pins: Pin[] = engine.nodePins(x.run, x.node) ?? [];
  const out: SkillRound = { skills: [], textOnly: [], root: null };
  for (const p of pins) {
    const lv = engine.skillLibrary().libVersion(p.id, p.v); if (!lv) continue; // an unknown pin fails where the text is read
    if (p.filesSha256 !== undefined && p.filesSha256 !== lv.rec.filesSha256) throw new RoundBlocked(`skill ${p.id}@v${p.v}: the pinned files hash does not match the library; the round was not started`);
    if (!pk.isScript(p.id, p.v)) continue;
    const now = pk.status(p.id, p.v);
    if (now.state === "needs-approval") throw new RoundBlocked(now.reasons[0]?.en ?? `skill ${p.id}@v${p.v} has scripts and is not approved`);
    if (now.state === "text-only") { out.textOnly.push({ id: p.id, v: p.v }); continue; }
    const st = await pk.ensure(p.id, p.v, engine.abortOf?.(x.run)?.signal);
    if (st.blocking) throw new RoundBlocked(`skill ${p.id}@v${p.v} is not ready: ${st.reasons.map((r) => r.en).join("; ")}`);
    if (!out.root) out.root = engine.roundDir(x, "skills", { label: "skills" });
    let dir: string; try { dir = pk.roundCopy(p.id, p.v, out.root!); } catch (e: any) { throw new RoundBlocked(String(e?.message ?? e)); }
    out.skills.push({ id: p.id, v: p.v, sha256: lv.rec.sha256, filesSha256: lv.rec.filesSha256, dir, status: st, run: true });
  }
  return out.skills.length || out.textOnly.length ? out : null;
}
/** The text added after the skills: where each script skill's files are and which tools reach them, or the text-only note. */
export function skillFooters(sr: SkillRound | null | undefined): string {
  if (!sr) return "";
  return [...sr.skills.map((s) => `\n\n# Skill files: ${s.id} (v${s.v})${skillFooter({ id: s.id, v: s.v, dir: s.dir, state: s.status.state, run: s.run, missing: s.status.bins.filter((b) => b.state === "missing").map((b) => b.name) })}`),
    ...sr.textOnly.map((t) => `\n\n# Skill scripts: ${t.id} (v${t.v})${skillFooter({ id: t.id, v: t.v, dir: null, state: "text-only", run: false, missing: [] })}`)].join("");
}
/** The step's record of its script skills (provenance): version, both hashes, the decision and its signature. */
export function skillProvenance(sr: SkillRound | null | undefined, pk: SkillPackages | null) {
  if (!sr || !pk) return [];
  return [...sr.skills.map((s) => ({ id: s.id, v: s.v, sha256: s.sha256, filesSha256: s.filesSha256, scripts: "approved", approval: s.status.decision?.sig.slice(0, 16) ?? null, card: s.status.decision?.card ?? null, env: s.status.envKey })),
    ...sr.textOnly.map((t) => { const d = pk.decision(t.id, t.v); return { id: t.id, v: t.v, sha256: d?.sha256 ?? null, filesSha256: d?.filesSha256 ?? null, scripts: "text-only", approval: d?.sig.slice(0, 16) ?? null, card: d?.card ?? null, env: null }; })];
}
/** The round's skill tools, recording every call. writes/cwd: where the round itself writes (skill_run gets nothing more). */
export function roundSkillTools(engine: any, x: any, sr: SkillRound | null | undefined, sb: { writes: string[]; cwd?: string }) {
  if (!sr?.skills.length) return [];
  const pk: SkillPackages = engine.deps.skillPackages;
  return skillTools({ skills: sr.skills, packages: pk,
    round: { cwd: sb.cwd ?? sb.writes[0], writes: sb.writes, tmp: `${sr.root}/.tmp`, dataDir: engine.deps.dataDir, protect: engine.deps.protectedRoots ?? [], egress: engine.deps.agents?.egress ?? null,
      run: x.run.id, node: x.node.id, visit: x.visit, signal: engine.abortOf?.(x.run)?.signal },
    record: (r: SkillRunRecord) => {
      x.rn.data = { ...x.rn.data, skillRuns: [...(x.rn.data.skillRuns ?? []), { ...r, round: x.visit }].slice(-60) };
      engine.record(x, "skill-run", { verdict: r.exit === 0 && !r.timedOut ? "pass" : "fail", evidence: [`skill-run:${r.skill}@v${r.v}/${r.script}`], ms: r.ms,
        data: { schema: 1, skill: r.skill, v: r.v, sha256: r.sha256, filesSha256: r.filesSha256, script: r.script, scriptSha256: r.scriptSha256, argv: r.argv, exit: r.exit, timedOut: r.timedOut, egress: r.egress } });
      if (r.egress.refused.length) {
        const add = r.egress.refused.map((e) => ({ node: x.node.id, visit: x.visit, skill: `${r.skill}@v${r.v}`, script: r.script, host: e.host, why: e.why, at: new Date().toISOString() }));
        x.run.ctx.skillRefusals = [...(x.run.ctx.skillRefusals ?? []), ...add].slice(-20);
        engine.emit(x.run, "skill_host_refused", `${x.node.label}: skill ${r.skill}@v${r.v} tried ${[...new Set(add.map((a) => a.host))].join(", ")}, not in its approved hosts`, { node: x.node.id, skill: `${r.skill}@v${r.v}`, hosts: add.map((a) => a.host) });
      }
      x.save();
    } });
}
