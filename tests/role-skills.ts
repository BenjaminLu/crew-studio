import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Role skills reach every agent turn and every judge (captain report: "code worker/reviewer/designer
// workflow don't seem to correctly use these roles' skills"). The REAL code-firstmate modes (spec,
// build, review, rootcause) run on the sandbox repository with the stub provider; every provider.start
// is recorded with the text it was sent, and:
//   - each mode's system text carries its role's pack skill body (coordinator, worker, reviewer);
//   - the designer-compare judge gets the designer skill, spec judges the spec node's (coordinator) skill,
//     and every judge goes through the composer (Studio's safety rules first);
//   - the refine loop's rootcause turns keep the coordinator nodes' skill pins (plain-writing);
//   - the run's steps (the run page's Agent rounds panel) and each round record name the role skill
//     (ref, Studio version, sha256) and the node skills, judges included;
//   - one source of truth: rounds read Studio's versioned copy (src/skills.ts), the text the Improve page
//     shows and edits; a stale imported copy is refreshed from the pack, keeping its history; an adopted edit
//     is what agents then receive.
//      bun tests/role-skills.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("role-skills");
const root = join(import.meta.dir, "..");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const pack = (role: string) => readFileSync(join(root, "packs/firstmate/skills", `${role}.md`), "utf8");

// ---------- the store: a stale import is refreshed from its source, history kept; an adopted edit stays current ----------
const { Skills, SAFETY_RULES } = await import("../src/skills");
{
  const data = checkedTempDir("crew-role-skills-store-");
  let source = "# Old worker text\n";
  const S = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
  S.extraSource = () => ({ text: source, source: "pack:firstmate/skills/worker.md" });
  ok(S.current("code-firstmate", "worker").text === source && S.index("code-firstmate", "worker").length === 1, "the first use imports v1 from the source");
  // a copy imported before this change (no source hash recorded), and then the pack moved on: the R-058 case
  const d = join(data, "skills", "code-firstmate", "worker"); const idx = JSON.parse(readFileSync(join(d, "index.json"), "utf8")); delete idx[0].source256; writeFileSync(join(d, "index.json"), JSON.stringify(idx));
  source = pack("worker");
  const cur = S.current("code-firstmate", "worker");
  ok(cur.n === 2 && cur.text === source && S.text("code-firstmate", "worker", 1) === "# Old worker text\n" && /refreshed from pack:firstmate\/skills\/worker\.md/.test(S.index("code-firstmate", "worker")[1].reason),
    "a stale imported copy is refreshed from the changed pack text as v2; v1 stays as history", JSON.stringify(S.index("code-firstmate", "worker")));
  ok(S.current("code-firstmate", "worker").n === 2 && S.index("code-firstmate", "worker").length === 2, "an unchanged source adds no version");
  S.write("code-firstmate", "worker", source + "\n- A captain rule.\n", { by: "captain", reason: "adopted edit", edit: "E-1", parent: 2 });
  source = source + "\n- A pack change after the edit.\n";
  const edited = S.current("code-firstmate", "worker");
  ok(edited.n === 3 && edited.text.includes("A captain rule.") && edited.sourceChanged, "an adopted edit stays what agents receive when the source moves on, and the change is reported");
  ok(/A captain rule/.test(S.patch("code-firstmate", "worker")) && !/Old worker text/.test(S.patch("code-firstmate", "worker")), "the patch for the source starts at the import the edit derives from");
}

// ---------- the real code-firstmate modes with the stub provider ----------
const data = checkedTempDir("crew-role-skills-");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { Projects } = await import("../src/doors");
const { skillTextFor } = await import("../src/runtime");
const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data, checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: data, projects: new Projects(data) });
E.policies.setProject("sandbox", { install: false });
// as the server wires it: the pack's text as the source, rounds read Studio's versioned copy
E.deps.skillText = skillTextFor(root);
const store = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
// a stale copy of the worker skill from before the pack changed (R-058: "# Worker (Studio runs)")
{ const d = join(data, "skills", "code-firstmate", "worker"); mkdirSync(d, { recursive: true }); const stale = "# Worker (Studio runs)\n\nDerived from firstmate's worker skill.\n";
  writeFileSync(join(d, "v1.md"), stale); writeFileSync(join(d, "index.json"), JSON.stringify([{ n: 1, sha256: sha(stale), parent: null, by: "import", reason: "imported from pack:firstmate/skills/worker.md", edit: null, createdAt: new Date().toISOString(), lines: 3 }])); }
E.deps.roleSkill = (wf: string, role: string, ref: string) => { const c = store.current(wf, role, { text: E.deps.skillText(ref), source: ref }); return { text: c.text, version: c.n }; };
// every provider.start: the system text it got and the first line of the turn it was sent
const starts: { system: string; first: string }[] = [];
const baseProvider = E.deps.provider;
E.deps.provider = (id?: string, model?: string) => { const p = baseProvider(id, model);
  return { ...p, start: (system: string, tools: any, ctx: any) => { const s = p.start(system, tools, ctx); const rec = { system, first: "" }; starts.push(rec);
    return { ...s, interrupt: () => s.interrupt(), send: (text: string) => { if (!rec.first) rec.first = text.split("\n")[0]; return s.send(text); } }; } }; };

const intent = [
  "Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100); \\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n',
  "STUB_FIX src/percent.ts :: / 100);  => / 100);",
].join("\n");
const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };
const dispatch = await waitCard("dispatch");
ok(!!dispatch, "the spec reaches the dispatch card", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
await E.answer(dispatch!.id, { choice: "dispatch", by: "captain" });
const merge = await waitCard("merge");
ok(!!merge, "the run reaches the merge card (build ⇄ fix, review, judges)", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
const g = E.get(r.id)!;

const turns = (prefix: string) => starts.filter((s) => s.first.startsWith(prefix));
const carries = (prefix: string, role: string) => { const t = turns(prefix); return t.length > 0 && t.every((s) => s.system.includes(pack(role).trim())); };
const firstLines = JSON.stringify([...new Set(starts.map((s) => s.first))]);
ok(carries("SPEC DRAFT", "firstmate"), "spec: every provider.start carries the coordinator skill (packs/firstmate/skills/firstmate.md)", firstLines);
ok(carries("BUILD ROUND", "worker"), "build: every provider.start carries the worker skill (packs/firstmate/skills/worker.md), not the stale copy", firstLines);
ok(!starts.some((s) => s.system.includes("# Worker (Studio runs)")), "no turn received the stale imported worker text");
ok(carries("CODE REVIEW", "reviewer"), "review: every provider.start carries the reviewer skill (packs/firstmate/skills/reviewer.md)", firstLines);
ok(carries("ROOT CAUSE", "firstmate"), "rootcause: every provider.start carries the coordinator skill", firstLines);
const plain = readFileSync(join(root, "packs/core/skills/plain-writing/SKILL.md"), "utf8");
const plainBody = (await import("../src/skills")).splitFrontmatter(plain).body.trim();
ok(turns("ROOT CAUSE").every((s) => s.system.includes("# Skill: plain-writing (v1)") && s.system.includes(plainBody)), "rootcause: the loop turn keeps the coordinator nodes' skill pin (plain-writing)");
ok(carries("JUDGE designer-compare", "designer"), "the designer-compare judge gets the designer skill (packs/firstmate/skills/designer.md)", firstLines);
ok(carries("JUDGE no-impl-detail", "firstmate") && carries("JUDGE done-lines-observable", "firstmate") && !turns("JUDGE no-impl-detail").some((s) => s.system.includes(pack("reviewer").trim())),
  "spec judges work as the spec node's role (coordinator), not the reviewer", firstLines);
ok(turns("JUDGE").length > 0 && turns("JUDGE").every((s) => s.system.startsWith(SAFETY_RULES)), "every judge's instructions go through the composer: Studio's safety rules first");

// the run page's Agent rounds panel reads these steps; the round record's header names the same
const step = (node: string) => g.steps.filter((s: any) => s.node === node && s.state !== "superseded").at(-1) as any;
const worker = store.current("code-firstmate", "worker");
ok(step("build")?.roleSkill?.ref === "pack:firstmate/skills/worker.md" && step("build").roleSkill.version === worker.n && worker.n === 2 && step("build").roleSkill.sha256 === sha(pack("worker")) && Array.isArray(step("build").skills),
  "the build step names the role skill it got: ref, Studio version (v2: refreshed from the pack) and sha256", JSON.stringify(step("build")?.roleSkill));
ok(step("spec")?.roleSkill?.role === "coordinator" && step("spec").skills.join() === "plain-writing@v1", "the spec step names the coordinator skill and its node skill", JSON.stringify([step("spec")?.roleSkill, step("spec")?.skills]));
ok(step("review")?.roleSkill?.sha256 === sha(pack("reviewer")), "the review step names the reviewer skill", JSON.stringify(step("review")?.roleSkill));
ok(step("fix")?.roleSkill?.role === "coordinator" && step("fix").skills.includes("plain-writing@v1"), "the refine loop's step names its rootcause turn's role skill and kept pins", JSON.stringify([step("fix")?.roleSkill, step("fix")?.skills]));
const dj = (step("review")?.judges ?? []).find((j: any) => j.check === "firstmate/designer-compare");
ok(dj?.role === "designer" && dj.roleSkill?.ref === "pack:firstmate/skills/designer.md" && dj.roleSkill.sha256 === sha(pack("designer")), "the designer judge call is listed on the review step with the designer skill", JSON.stringify(step("review")?.judges));
ok((step("spec")?.judges ?? []).some((j: any) => j.check === "firstmate/no-impl-detail" && j.role === "coordinator"), "the spec's judge calls are listed on its step with their role", JSON.stringify(step("spec")?.judges));
const rec = join(data, "runs", r.id, "nodes", "build", "1", "prompt.md");
ok(existsSync(rec) && readFileSync(rec, "utf8").includes(`"sha256":"${sha(pack("worker"))}"`) && /\nmode: "build"/.test(readFileSync(rec, "utf8")), "the round record's header names the mode and the role skill's sha256", existsSync(rec) ? readFileSync(rec, "utf8").slice(0, 600) : "no record");

// an adopted edit is what the next round receives (the Improve page edits the text agents get)
store.write("code-firstmate", "reviewer", pack("reviewer") + "\n- Adopted captain rule: run the tests yourself.\n", { by: "captain", reason: "adopted edit", edit: "E-9", parent: store.current("code-firstmate", "reviewer").n });
const x = E.x(g, g.def.nodes.find((n: any) => n.id === "review")!, g.nodes.review);
ok(x.skill().includes("Adopted captain rule: run the tests yourself."), "an adopted role-skill edit reaches the reviewer's instructions");
await E.cancel(r.id, "captain");
H.stop();
end();
