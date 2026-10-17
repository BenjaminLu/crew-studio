import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Role skills reach every agent turn and every judge (captain report: "code worker/reviewer/designer
// workflow don't seem to correctly use these roles' skills"). The REAL code-firstmate modes (spec,
// build, review, rootcause) run on the sandbox repository with the stub provider; every provider.start
// is recorded with the text it was sent, and:
//   - each mode's system text carries its role's pack skill body (coordinator, worker, reviewer);
//   - the designer round (a UI change) and its designer-compare judge get the designer skill, spec judges the reviewer skill they declare (judge.role),
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
// two readers with two refs for one role (documents/writer: the v2 definition's bundled ref, the legacy flow's pack ref) never add versions in turn
{
  const data = checkedTempDir("crew-role-skills-refs-");
  const S = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => ({ text: "LEGACY pack writer", source: "pack:documents/skills/writer.md" }) } as any);
  S.extraSource = () => ({ text: "RUNTIME v2 writer", source: "bundled:workflows/skills/v2/writer.md" }); // as the server wires it: the runtime definition first
  for (let i = 0; i < 3; i++) { S.current("documents", "writer", { text: "RUNTIME v2 writer", source: "bundled:workflows/skills/v2/writer.md" }); S.text("documents", "writer"); S.ensure("documents", "writer"); S.current("documents", "writer"); }
  ok(S.index("documents", "writer").length === 1 && S.text("documents", "writer") === "RUNTIME v2 writer", "alternating runtime and page reads keep one version, and the page shows the runtime's text", JSON.stringify(S.index("documents", "writer").map((v) => v.reason)));
  S.current("documents", "writer", { text: "OTHER ref text", source: "pack:documents/skills/writer.md" });
  ok(S.index("documents", "writer").length === 1, "a source with another ref than the recorded one writes nothing");
  { const bare = new Skills(checkedTempDir("crew-role-skills-bare-"), { list: () => [], get: () => null, sourceSkill: () => ({ text: "LEGACY pack writer", source: "pack:documents/skills/writer.md" }) } as any);
    for (let i = 0; i < 3; i++) { bare.current("documents", "writer", { text: "RUNTIME v2 writer", source: "bundled:workflows/skills/v2/writer.md" }); bare.text("documents", "writer"); }
    ok(bare.index("documents", "writer").length === 1 && bare.text("documents", "writer") === "RUNTIME v2 writer", "with no runtime resolver either, sourceless reads never move the ref the runtime imported", JSON.stringify(bare.index("documents", "writer").map((v) => v.reason))); }
  // an older store imported from the legacy ref moves once to the runtime's ref, then stays put
  const old = new Skills(checkedTempDir("crew-role-skills-legacy-"), { list: () => [], get: () => null, sourceSkill: () => ({ text: "LEGACY pack writer", source: "pack:documents/skills/writer.md" }) } as any);
  old.current("documents", "writer"); old.extraSource = S.extraSource;
  for (let i = 0; i < 3; i++) { old.current("documents", "writer", { text: "RUNTIME v2 writer", source: "bundled:workflows/skills/v2/writer.md" }); old.text("documents", "writer"); }
  ok(old.index("documents", "writer").length === 2 && old.text("documents", "writer") === "RUNTIME v2 writer", "a legacy-ref import moves to the runtime's ref once (history kept), with no churn after", JSON.stringify(old.index("documents", "writer").map((v) => v.reason)));
}
// a corrupt index never makes Studio import over v1; a new version never overwrites a file
{
  const data = checkedTempDir("crew-role-skills-corrupt-");
  const S = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
  S.extraSource = () => ({ text: "# v1 text\n", source: "pack:firstmate/skills/worker.md" });
  S.current("code-firstmate", "worker");
  const d = join(data, "skills", "code-firstmate", "worker"); writeFileSync(join(d, "index.json"), "{ not json");
  let threw = ""; try { S.current("code-firstmate", "worker", { text: "# other\n", source: "pack:firstmate/skills/worker.md" }); } catch (err: any) { threw = String(err?.message); }
  ok(/index\.json cannot be read/.test(threw) && readFileSync(join(d, "v1.md"), "utf8") === "# v1 text\n", "a corrupt index.json refuses (named) and v1.md is untouched", threw);
  // a version file left by a crash before its index write is kept: the next version takes the next free number
  const d2 = join(checkedTempDir("crew-role-skills-orphan-"), "skills", "code-firstmate", "worker"); const S2 = new Skills(join(d2, "..", "..", ".."), { list: () => [], get: () => null, sourceSkill: () => null } as any);
  S2.extraSource = S.extraSource; S2.current("code-firstmate", "worker"); writeFileSync(join(d2, "v2.md"), "# orphan\n");
  const v = S2.write("code-firstmate", "worker", "# edit\n", { by: "captain", reason: "edit", edit: null, parent: 1 });
  ok(v.n === 3 && readFileSync(join(d2, "v2.md"), "utf8") === "# orphan\n" && S2.text("code-firstmate", "worker", 3) === "# edit\n", "an orphan version file is never overwritten", String(v.n));
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
  // a UI path too (policy ui_paths: **/*.html), so the designer round runs (diff-only: the sandbox declares no app)
  "STUB_FILE public/percent.html :: <!doctype html><title>Percent</title><h1>15% of $19.99 is $3.00</h1>\\n",
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

const L = (id: string, check: string) => E.ledger(id).filter((e: any) => e.check === check);
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
ok(L(r.id, "firstmate/design-scope").at(-1)?.data?.route === "ui" && carries("DESIGN REVIEW", "designer"), "designer: the change touches UI, and every designer round's provider.start carries the designer skill (packs/firstmate/skills/designer.md)", firstLines);
ok(carries("JUDGE designer-compare", "designer"), "the designer-compare judge (on the designer node) gets the designer skill (packs/firstmate/skills/designer.md)", firstLines);
ok(carries("JUDGE no-impl-detail", "reviewer") && carries("JUDGE done-lines-observable", "reviewer") && !turns("JUDGE no-impl-detail").some((s) => s.system.includes(pack("firstmate").trim())),
  "spec judges work as the reviewer they declare (judge.role), never the coordinator judging its own spec", firstLines);
ok(turns("JUDGE").length > 0 && turns("JUDGE").every((s) => s.system.startsWith(SAFETY_RULES)), "every judge's instructions go through the composer: Studio's safety rules first");

// the run page's Agent rounds panel reads these steps; the round record's header names the same
const step = (node: string) => g.steps.filter((s: any) => s.node === node && s.state !== "superseded").at(-1) as any;
const worker = store.current("code-firstmate", "worker");
ok(step("build")?.roleSkill?.ref === "pack:firstmate/skills/worker.md" && step("build").roleSkill.version === worker.n && worker.n === 2 && step("build").roleSkill.sha256 === sha(pack("worker")) && Array.isArray(step("build").skills),
  "the build step names the role skill it got: ref, Studio version (v2: refreshed from the pack) and sha256", JSON.stringify(step("build")?.roleSkill));
ok(step("spec")?.roleSkill?.role === "coordinator" && step("spec").skills.join() === "plain-writing@v1", "the spec step names the coordinator skill and its node skill", JSON.stringify([step("spec")?.roleSkill, step("spec")?.skills]));
ok(step("review")?.roleSkill?.sha256 === sha(pack("reviewer")), "the review step names the reviewer skill", JSON.stringify(step("review")?.roleSkill));
ok(step("fix")?.roleSkill?.role === "coordinator" && step("fix").skills.includes("plain-writing@v1"), "the refine loop's step names its rootcause turn's role skill and kept pins", JSON.stringify([step("fix")?.roleSkill, step("fix")?.skills]));
ok(step("designer")?.roleSkill?.role === "designer" && step("designer").roleSkill.ref === "pack:firstmate/skills/designer.md" && step("designer").roleSkill.sha256 === sha(pack("designer")), "the designer step names the designer skill", JSON.stringify(step("designer")?.roleSkill));
const dj = (step("designer")?.judges ?? []).find((j: any) => j.check === "firstmate/designer-compare");
ok(dj?.role === "designer" && dj.roleSkill?.ref === "pack:firstmate/skills/designer.md" && dj.roleSkill.sha256 === sha(pack("designer")), "the designer judge call is listed on the designer step with the designer skill", JSON.stringify(step("designer")?.judges));
ok((step("spec")?.judges ?? []).some((j: any) => j.check === "firstmate/no-impl-detail" && j.role === "reviewer"), "the spec's judge calls are listed on its step with their role", JSON.stringify(step("spec")?.judges));
const rec = join(data, "runs", r.id, "nodes", "build", "1", "prompt.md");
ok(existsSync(rec) && readFileSync(rec, "utf8").includes(`"sha256":"${sha(pack("worker"))}"`) && /\nmode: "build"/.test(readFileSync(rec, "utf8")), "the round record's header names the mode and the role skill's sha256", existsSync(rec) ? readFileSync(rec, "utf8").slice(0, 600) : "no record");

// an adopted edit is what the next round receives (the Improve page edits the text agents get)
store.write("code-firstmate", "reviewer", pack("reviewer") + "\n- Adopted captain rule: run the tests yourself.\n", { by: "captain", reason: "adopted edit", edit: "E-9", parent: store.current("code-firstmate", "reviewer").n });
const x = E.x(g, g.def.nodes.find((n: any) => n.id === "review")!, g.nodes.review);
ok(x.skill().includes("Adopted captain rule: run the tests yourself."), "an adopted role-skill edit reaches the reviewer's instructions");
await E.cancel(r.id, "captain");
H.stop();

// ---------- a role skill that changed since staffing approval: the readiness card's one-click way out ----------
{
  const { StaffingStore, installStaffingGuard, staffingHash } = await import("../src/domain/staffing");
  const { Y } = await import("./rt-harness");
  const ref = "pack:firstmate/skills/worker.md";
  const flow = { id: "code-firstmate", name: "Skill change fixture", kind: "code", version: 1, roles: [{ id: "worker", label: "Worker", skill: ref }],
    nodes: [{ id: "wait", kind: "card", label: "Wait", x: 0, y: 0, card: { options: [{ id: "go", label: "Go" }] } }, { id: "work", kind: "agent", label: "Work", role: "worker", mode: "test", x: 1, y: 0 }],
    edges: [["wait", "work", "go"]] };
  const h = await harness([Y(flow)], { data: checkedTempDir("crew-role-skills-staffing-") }), e = h.engine, staffing = new StaffingStore(h.data), project = { namespace: "git" as const, id: "p", identity: "isolated-skill-change" };
  try {
    installStaffingGuard(e, staffing, () => project);
    let text = "# Worker skill, as approved\n";
    e.deps.skillText = () => text;
    const def = e.defs.get(flow.id)!;
    const pin = staffing.remember({ ref, version: 1, text });
    const c1 = staffing.approve({ schema: 1, algorithm: "sha256-canonical-v1", project, workflow: { id: def.id, version: def.version, sha256: staffingHash(def) }, roles: { worker: { provider: "codex", model: "chosen-model", effort: "high", skill: pin } }, review: { freshContexts: 3, distinctProviders: false } }, null, { run: "R-src", card: "SC-src", answerSeq: 1 });
    const systems: string[] = [];
    e.modes.test.system = (_x: any, skill: string) => skill;
    e.deps.selectProvider = async (_x: any, p: any) => { const base = e.deps.provider(p.provider, p.model); return { ...base, reasoningEffort: p.effort, start: (sys: string, tools: any, ctx: any) => { systems.push(sys); return base.start(sys, tools, ctx); } }; };
    const task = e.start({ workflow: flow.id, text: "fixture", params: { project: project.id, _staffing: c1.hash } });
    const other = e.start({ workflow: flow.id, text: "fixture 2", params: { project: project.id, _staffing: c1.hash } });
    await until(() => task.nodes.wait.waiting === "card" && other.nodes.wait.waiting === "card");
    // the pack text changes after the captain approved staffing (a Studio update)
    text = "# Worker skill, new pack text\n\n- A new rule.\n";
    await e.answer(task.nodes.wait.card!, { choice: "go", by: "captain" });
    await until(() => task.nodes.work.waiting === "card" && !e.busy(task.id));
    const card = e.cards.get(task.nodes.work.card!)!;
    ok(card?.failure?.code === "env.skill-changed" && card.options.some((o: any) => o.id === "approve-skill") && card.captainOnly === true && !systems.length,
      "a changed role skill holds the round on a captain card (env.skill-changed) with \"Approve new role skill\"; nothing ran", JSON.stringify([card?.failure?.code, card?.options?.map((o: any) => o.id), systems.length]));
    { const shown = JSON.stringify(card); ok(/Worker skill, as approved/.test(shown) && /\+- A new rule\./.test(shown), "the card shows the change: the approved pin's text → the new text", shown.slice(0, 900)); }
    ok(JSON.stringify(card.sections?.zh ?? card).includes("+- A new rule."), "the zh-TW side shows the same diff", JSON.stringify(card.sections?.zh ?? {}).slice(0, 300));
    { let msg = ""; try { await e.answer(card.id, { choice: "approve-skill", by: "firstmate" }); } catch (err: any) { msg = String(err?.message); }
      ok(/Only the captain approves a role skill change/.test(msg) && staffing.current(project).version === 1, "only the captain can approve a role skill change", msg); }
    // the text changes again after the card was shown: approving would approve text the captain never saw
    text = text + "- An unseen rule.\n";
    { let msg = ""; try { await e.answer(card.id, { choice: "approve-skill", by: "captain" }); } catch (err: any) { msg = String(err?.message); }
      ok(/Role skill approval is stale: the text changed after this card was shown/.test(msg) && staffing.current(project).version === 1 && !systems.length && task.nodes.work.card === card.id,
        "a text change after the card refuses the approval: no staffing version, no round", msg); }
    await e.answer(card.id, { choice: "retry", by: "captain" });
    await until(() => task.nodes.work.waiting === "card" && task.nodes.work.card !== card.id && !e.busy(task.id));
    const fresh = e.cards.get(task.nodes.work.card!)!;
    ok(fresh?.failure?.code === "env.skill-changed" && JSON.stringify(fresh).includes("+- An unseen rule.") && !systems.length, "retry raises a new card with the new diff", JSON.stringify([fresh?.failure?.code, task.status]));
    await e.answer(fresh.id, { choice: "approve-skill", by: "captain" });
    await until(() => ["succeeded", "failed"].includes(task.status) && !e.busy(task.id));
    const c2 = staffing.current(project);
    ok(task.status === "succeeded" && systems.length === 1 && systems[0].includes("- A new rule.") && e.list().filter((x) => x.workflow === flow.id).length === 2,
      "one click: the same task continues and its round receives the new text", JSON.stringify([task.status, task.error, systems.length]));
    ok(c2.version === 2 && c2.roles.worker.provider === "codex" && c2.roles.worker.model === "chosen-model" && c2.roles.worker.effort === "high" && c2.roles.worker.skill.sha256 === sha(text) && c2.previous === c1.hash,
      "a new staffing version replaces only the changed skill pin (provider, model and effort unchanged)", JSON.stringify(c2.roles));
    const up = e.ledger(task.id).filter((x: any) => x.record === "staffing-upgrade");
    ok(up.length === 1 && up[0].data.config === c2.hash && up[0].data.previous === c1.hash && up[0].data.reason === "role-skill" && e.deps.staffingBinding!(task) === c2.hash, "the task is rebound by a signed staffing-upgrade entry");
    // another task still bound to the old approval gets the same way out, and only rebinds to the approval that already covers the new text
    await e.answer(other.nodes.wait.card!, { choice: "go", by: "captain" });
    await until(() => other.nodes.work.waiting === "card" && !e.busy(other.id));
    const card2 = e.cards.get(other.nodes.work.card!)!;
    ok(card2?.failure?.code === "env.skill-changed" && card2.options.some((o: any) => o.id === "approve-skill"), "a task bound to the earlier approval gets the same typed hold and option", JSON.stringify([card2?.failure?.code, card2?.body?.slice(0, 300)]));
    await e.answer(card2.id, { choice: "approve-skill", by: "captain" });
    await until(() => ["succeeded", "failed"].includes(other.status) && !e.busy(other.id));
    ok(other.status === "succeeded" && staffing.current(project).version === 2 && e.deps.staffingBinding!(other) === c2.hash && systems.length === 2 && systems[1].includes("- A new rule."),
      "it rebinds to the existing new approval (no third version) and continues with the new text", JSON.stringify([other.status, other.error, staffing.current(project).version]));
    // a judge.role the workflow does not define is a clear error, not a silent fallback
    { const jx = e.x(task, task.def.nodes.find((n: any) => n.id === "work")!, task.nodes.work); let msg = "";
      try { e.judgeRole(jx, { id: "x", ref: "t/x", judge: { prompt: "", role: "designer" } } as any); } catch (err: any) { msg = String(err?.message); }
      ok(/judges as role "designer", which workflow code-firstmate does not define \(roles: worker\)/.test(msg) && e.judgeRole(jx, { id: "x", ref: "t/x", judge: { prompt: "" } } as any) === "worker", "an undefined judge.role is refused by name; without one the judge works as the node's role", msg); }
  } finally { for (const x of e.list()) if (!["succeeded", "failed", "cancelled"].includes(x.status)) await e.cancel(x.id, "fixture cleanup"); h.stop(); }
}
end();
