// Named captain steps a stub run names in `setup:` (before its start) or `before:` (before it answers a
// card). Each is something the captain does on the board, through the same HTTP route.
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drive, verify, answerCard, type Decide } from "./drive";
import type { Studio } from "./studio";

export type Ctx = { s: Studio; vars: Record<string, string>; firstmate(marker: "NATIVE-PROPOSE " | "NATIVE-PROJECT ", args: unknown): Promise<any[]> };
type Step = (h: Ctx, card?: any, view?: any) => Promise<void | { note?: string; choice?: string }>;
const git = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", ...a], { cwd, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); };
const approveOnly: Decide = async (c) => ({ choice: c.options?.some((o: any) => o.id === "approve") ? "approve" : "?" });

/** The staffing interview and its captain-only confirmation card, for every role of one workflow. */
export async function approveStaffing(h: Ctx, project: string, workflow: string): Promise<string> {
  const version = (await h.s.api(`/api/wf/${workflow}`)).body.def.version, base = { project, workflow, version };
  let r = (await h.s.api(`/api/intake/staffing?project=${encodeURIComponent(project)}&workflow=${workflow}&version=${version}`)).body;
  if (r.error) throw new Error(`staffing interview refused: ${r.error}`);
  const roles = [...new Set<string>((r.frontier ?? []).map((q: any) => q.role))];
  for (const [field, value] of [["provider", "codex"], ["model", "fixture-model"], ["effort", "low"]]) {
    const res = await h.s.api("/api/intake/staffing", { ...base, answers: Object.fromEntries(roles.map((id) => [id, { [field]: value }])) });
    if (res.status !== 200 || res.body.error) throw new Error(`staffing ${field} answer refused: ${res.status} ${res.body.error ?? ""}`); r = res.body;
  }
  if (!r.complete) throw new Error(`staffing interview not complete: ${JSON.stringify(r.frontier).slice(0, 300)}`);
  const conf = await h.s.api("/api/intake/staffing", { ...base, roles: r.choices, confirm: true });
  if (conf.status !== 200 || !conf.body.proposal) throw new Error(`staffing confirmation refused: ${conf.status} ${JSON.stringify(conf.body).slice(0, 300)}`);
  return conf.body.proposal;
}

/** One staffing approval per Studio and project: concurrent runs share it (the interview is one per project). */
const staffed: Record<string, Promise<void>> = {};
async function approveCode(h: Ctx) { const id = await approveStaffing(h, h.vars.project, "code-firstmate"); const d = await drive(h.s, id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["confirm", "activate", "done"] }); if (bad.length) throw new Error(`staffing: ${bad.join("; ")}`); }

export const STEPS: Record<string, Step> = {
  /** the Claude account card's Verify (one bounded request on the exact configured model); its receipt admits Claude rounds for 30 s */
  async "verify-claude"(h) { const r = await h.s.api("/api/claude/native/verify", { model: "claude-sonnet-5-5", effort: null, confirm: true }); if (r.status !== 200 || r.body.admission !== "verified-execution") throw new Error(`Claude verify: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); },
  /** a throwaway folder with a few files to tidy: {folder} */
  async folder(h) { const d = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-folder-"))); for (const f of ["report.pdf", "photo.jpg", "notes.txt", "song.mp3"]) writeFileSync(join(d, f), `acceptance ${f}\n`); h.vars.folder = d; },
  /** a throwaway local git repository: {repo} */
  async repo(h) { const d = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-repo-"))); git(d, "init", "-q", "-b", "main"); writeFileSync(join(d, "README.md"), "# Acceptance repo\n"); git(d, "add", "."); git(d, "commit", "-qm", "Initial"); h.vars.repo = d; },
  /** register {repo} through Firstmate (NATIVE-PROJECT) and approve the registration card: {project} */
  async register(h) {
    if (!h.vars.repo) await STEPS.repo(h);
    const runs = await h.firstmate("NATIVE-PROJECT ", { path: h.vars.repo, name: "Acceptance repo", workflow: "code-firstmate", version: 1, text: "Acceptance: register this repository", params: {} });
    const reg = runs.find((r) => r.workflow === "firstmate-register-project"); if (!reg) throw new Error("Firstmate prepared no project registration");
    const d = await drive(h.s, reg.id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["register", "continue", "done"] });
    if (bad.length) throw new Error(`registration: ${bad.join("; ")}`);
    const projects = (await h.s.api("/api/policies")).body.projects ?? [];
    const raw = JSON.parse(readFileSync(join(h.s.data, "projects.json"), "utf8")); const p = raw.find((x: any) => x.path && realpathSync(x.path) === h.vars.repo);
    if (!p || !projects.some((x: any) => x.id === p.id)) throw new Error("the registered project is not listed"); h.vars.project = p.id;
  },
  /** staffing for code-firstmate on {project} (default: the built-in sandbox project), approved on its card */
  async "staffing-code"(h) { h.vars.project ??= "sandbox"; const key = `${h.s.base} ${h.vars.project}`; staffed[key] ??= approveCode(h); return staffed[key]; },

  /** the coffee form's inputs: an approved coffee staffing and the validated design plan: {project}, {coffeeDesignPlan} */
  async coffee(h) {
    h.vars.project = "acceptance-coffee";
    staffed[`${h.s.base} coffee`] ??= (async () => { const id = await approveStaffing(h, "acceptance-coffee", "coffee-kit");
      const d = await drive(h.s, id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["confirm", "activate", "done"] }); if (bad.length) throw new Error(`coffee staffing: ${bad.join("; ")}`); })();
    await staffed[`${h.s.base} coffee`];
    const plan = JSON.parse(readFileSync(join(import.meta.dir, "../fixture/coffee-design.json"), "utf8"));
    const v = await h.s.api("/api/coffee/design", { plan }); if (v.status !== 200) throw new Error(`coffee design refused: ${JSON.stringify(v.body).slice(0, 300)}`); h.vars.coffeeDesignPlan = v.body.canonical;
  },
  // ---- pack genesis: what the captain does on the pack page before answering each card ----
  /** answer the six interview questions in the card's own form */
  async "pack-interview"(_h, card) { const f = card.interview; if (!f) throw new Error("the interview card carries no form"); return { note: JSON.stringify({ schema: 1, card: card.id, visit: card.visit, batchHash: f.batchHash, answers: Object.fromEntries(f.questions.map((q: any) => [q.key, `Acceptance answer for ${q.key}`])) }) }; },
  /** label the first sample good and the second bad, with a pin on the bad one */
  async "pack-label"(h, card) {
    const g = (await h.s.api(`/api/pack-genesis/${card.run}`)).body; if ((g.samples ?? []).length < 2) throw new Error(`pack genesis has ${(g.samples ?? []).length} samples`);
    const [good, bad] = g.samples;
    const n = await h.s.api(`/api/artifacts/${bad.artifact}/v/${bad.version}/notes`, { kind: "pin", selector: "button", bbox: { x: 10, y: 10, w: 80, h: 40 }, comment: "Give the empty button an accessible label" }); if (n.status !== 200) throw new Error(`note refused: ${JSON.stringify(n.body).slice(0, 200)}`);
    for (const [sample, label] of [[good.id, "good"], [bad.id, "bad"]]) { const r = await h.s.api(`/api/pack-genesis/${card.run}/labels`, { sample, label }); if (r.status !== 200) throw new Error(`label refused: ${JSON.stringify(r.body).slice(0, 200)}`); }
  },
  /** decide every offered proposal: reject (kept as a rejected fingerprint) */
  async "pack-proposals"(h, card) { const g = (await h.s.api(`/api/pack-genesis/${card.run}`)).body; for (const p of (g.proposals ?? []).filter((p: any) => p.status === "offered")) { const r = await h.s.api(`/api/pack-genesis/${card.run}/proposals/${p.id}`, { choice: "reject" }); if (r.status !== 200) throw new Error(`proposal decision refused: ${JSON.stringify(r.body).slice(0, 200)}`); } },
  /** one real shadow Task on the pinned candidate, accepted by the captain */
  async "pack-shadow"(h, card) {
    // the shadow Task runs the published-pack producer on Studio's default provider (Claude): the captain verifies Claude first
    await STEPS["verify-claude"](h);
    const r = await h.s.api(`/api/pack-genesis/${card.run}/shadow`, { text: "Create a good accessible page" }); if (r.status !== 200) throw new Error(`shadow start refused: ${JSON.stringify(r.body).slice(0, 300)}`);
    const d = await drive(h.s, r.body.task.id, async (c) => c.node === "accept" ? { choice: "accept" } : { stop: "the shadow Task's only captain card is its acceptance" }, { timeoutMs: 60_000 });
    const bad = await verify(h.s, d, { status: "succeeded", visited: ["accept"] }); if (bad.length) throw new Error(`shadow Task ${r.body.task.id}: ${bad.join("; ")}`);
  },
};
export { answerCard };
