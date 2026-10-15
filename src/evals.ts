// Replay evals: situations replayed from recorded runs (the event log), each
// asked of a role with a given skill text, graded by deterministic checks.
// A proposed skill edit runs every case twice (before and after) before it is
// offered. Two modes:
//   static  no model: the "answer" is the skill's own lines on the case's key
//           terms; a check passes when the skill states the expected behaviour.
//   model   one turn per case through any provider (the stub in tests).
//   data/evals/<workflow>/<role>.json   the cases
import { allocate } from "./ids";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Agents } from "./agent";
import type { Provider } from "./providers";

export type Check = { pattern: string; why: string };
export type EvalCase = { id: string; workflow: string; role: string; title: string; from: { task: string | null; actor: string | null; seq: number | null; ts: string | null; class?: string; retro?: string };
  situation: string; ask: string; terms: string[]; expect: Check[]; forbid?: Check[]; createdAt: string };
export type CaseResult = { case: string; title: string; pass: boolean; score: number; answer: string; checks: { why: string; ok: boolean; forbid?: boolean }[]; error?: string | null };
export type SuiteResult = { mode: "static" | "model"; provider: string; model: string; passed: number; total: number; results: CaseResult[]; at: string };

export const EVAL_SYSTEM = (role: string, skill: string) => `You are the ${role} in this workflow. Your instructions are the skill between the markers.
<<<SKILL
${skill}
SKILL>>>
You will get one situation replayed from a recorded run. Answer in at most 6 lines: what you do next and why. Quote the instruction you follow. Do not use tools.`;
export const caseText = (c: EvalCase) => `EVAL CASE ${c.id}\nSituation (replayed from ${c.from.actor ?? "a recorded run"}${c.from.task ? ` on ${c.from.task}` : ""}): ${c.situation}\nQuestion: ${c.ask}\nKey terms: ${c.terms.join(", ")}`;

/** The skill's own lines on the key terms (the static mode's answer, and the stub provider's). */
export function staticAnswer(skill: string, terms: string[]): string {
  const t = terms.map((x) => x.toLowerCase()).filter(Boolean);
  const need = Math.min(2, t.length);
  return skill.split("\n").filter((l) => { const s = l.toLowerCase(); return t.filter((x) => s.includes(x)).length >= need; }).slice(0, 12).join("\n");
}
export function grade(c: EvalCase, answer: string): CaseResult {
  const checks = [...c.expect.map((x) => ({ why: x.why, ok: new RegExp(x.pattern, "i").test(answer) })),
    ...(c.forbid ?? []).map((x) => ({ why: x.why, ok: !new RegExp(x.pattern, "i").test(answer), forbid: true }))];
  const okN = checks.filter((x) => x.ok).length;
  return { case: c.id, title: c.title, pass: !!answer.trim() && okN === checks.length, score: checks.length ? Math.round((okN / checks.length) * 100) / 100 : 0, answer: answer.slice(0, 1500), checks };
}

export class Evals {
  constructor(readonly dataDir: string, readonly agents: Agents) {}
  private file(wf: string, role: string) { return join(this.dataDir, "evals", wf, `${role}.json`); }
  cases(wf: string, role: string): EvalCase[] { try { return JSON.parse(readFileSync(this.file(wf, role), "utf8")); } catch { return []; } }
  all(): EvalCase[] { const out: EvalCase[] = []; const root = join(this.dataDir, "evals"); if (!existsSync(root)) return out;
    for (const wf of readdirSync(root)) for (const f of readdirSync(join(root, wf))) if (f.endsWith(".json")) out.push(...this.cases(wf, f.slice(0, -5))); return out; }
  add(c: Omit<EvalCase, "id" | "createdAt"> & { id?: string }): EvalCase {
    const list = this.cases(c.workflow, c.role);
    const id = c.id ?? allocate(join(this.dataDir, "evals"), `EV-${c.workflow}-${c.role}`, { existing: () => list.map((x) => x.id) });
    const prev = list.find((x) => x.id === id);
    if (prev) return prev;
    if (!c.expect?.length) throw new Error("a case needs at least one expected check");
    for (const x of [...c.expect, ...(c.forbid ?? [])]) new RegExp(x.pattern);
    const rec: EvalCase = { ...c, id, createdAt: new Date().toISOString() } as EvalCase;
    mkdirSync(join(this.dataDir, "evals", c.workflow), { recursive: true });
    writeFileSync(this.file(c.workflow, c.role), JSON.stringify([...list, rec], null, 1));
    return rec;
  }

  async run(cases: EvalCase[], skill: string, mode: "static" | "model", provider?: Provider, ref?: string): Promise<SuiteResult> {
    const results: CaseResult[] = [];
    for (const c of cases) {
      if (mode === "static" || !provider) { results.push(grade(c, staticAnswer(skill, c.terms))); continue; }
      const j = await this.agents.run({ kind: "eval", title: `eval ${c.id}`, system: EVAL_SYSTEM(c.role, skill), text: caseText(c), tools: [], provider, maxTools: 0, ref,
        timeoutMs: Number(process.env.CREW_EVAL_TIMEOUT_MS ?? 180_000) });
      const r = grade(c, j.status === "done" ? j.said : ""); if (j.status !== "done") r.error = j.error; results.push(r);
    }
    return { mode: mode === "model" && provider ? "model" : "static", provider: mode === "model" && provider ? provider.id : "none", model: mode === "model" && provider ? provider.model : "no model",
      passed: results.filter((r) => r.pass).length, total: results.length, results, at: new Date().toISOString() };
  }
}
