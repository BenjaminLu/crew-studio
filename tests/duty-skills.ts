import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Skills by duty (captain: "every node's default skill is plain-writing; reviewers don't get code-review, designers don't get
// design review, workers have no matching skill"). Every built-in workflow pins its nodes' skills by what the node does:
//   - every agent node, every judged check and every hook that runs a model turn (pr.open, image.generate) pins at least one
//     duty skill beyond plain-writing, each pin matching the built-in library text (packs/core/skills/<id>/SKILL.md, v1);
//   - a code workflow's reviewer nodes pin code-review; design reviewers (agent nodes and judged checks) pin visual-design-review;
//   - the system text a stub agent receives carries its role skill, then the member's skills, then the node's, in that order;
//     a judge receives its check's duty skills; the pull request text and the image request carry their hook's skills;
//   - the Crew page (#/team) and studio_crew_assignments name each node's role skill (ref, version, sha256), and a judge row its duty skills.
//      bun tests/duty-skills.ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const { parseYaml: parse } = await import("../src/bundled");
import { harness, suite, Y } from "./rt-harness";
const { ok, end } = suite("duty-skills");
const root = join(import.meta.dir, "..");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const skillText = (id: string) => readFileSync(join(root, `packs/core/skills/${id}/SKILL.md`), "utf8");
const pin = (id: string) => ({ id, v: 1, sha256: sha(skillText(id)) });
const C = await import("../src/domain/crew");
const { splitFrontmatter } = await import("../src/skills");
const body = (id: string) => splitFrontmatter(skillText(id)).body.trim();

// ---------- every built-in workflow, by duty ----------
const files = [...readdirSync(join(root, "workflows/v2")).filter((f) => f.endsWith(".wf.yaml")).map((f) => join(root, "workflows/v2", f)),
  ...readdirSync(join(root, "packs")).flatMap((p) => { try { return readdirSync(join(root, "packs", p, "workflows")).filter((f) => f.endsWith(".wf.yaml")).map((f) => join(root, "packs", p, "workflows", f)); } catch { return []; } })];
const manifest = (use: string): any => { const [pack, id] = use.split("/"); try { return parse(readFileSync(join(root, "packs", pack, "checks", id, "check.yaml"), "utf8")); } catch { return null; } };
// the startup competition keeps its own two-vendor pick and its own judge brief; no library skill fits a pitch judge
const EXEMPT = new Set(["startup-recursion"]);
const MODEL_HOOKS: Record<string, string> = { "pr.open": "commit-and-pr-text", "image.generate": "image-prompting" };
const duty = (pins: any[] | undefined) => (pins ?? []).filter((p) => p.id !== "plain-writing");
const badPins = (pins: any[] | undefined) => (pins ?? []).filter((p) => { try { return p.v !== 1 || p.sha256 !== sha(skillText(p.id)); } catch { return true; } }).map((p) => p.id);
let workflows = 0, agents = 0, judges = 0;
for (const f of files) {
  const d: any = parse(readFileSync(f, "utf8")); if (EXEMPT.has(d.id)) continue; workflows++;
  const seatOf = (n: any) => n.seat ?? d.roles?.find((r: any) => r.id === n.role)?.seat;
  for (const n of d.nodes ?? []) {
    if (n.kind === "agent") { agents++;
      ok(duty(n.skills).length > 0, `${d.id}/${n.id}: an agent node pins a duty skill beyond plain-writing`, JSON.stringify(n.skills?.map((p: any) => p.id)));
      if (d.kind === "code" && n.role === "reviewer") ok(n.skills?.some((p: any) => p.id === "code-review"), `${d.id}/${n.id}: a code reviewer pins code-review`, JSON.stringify(n.skills?.map((p: any) => p.id)));
      if (seatOf(n) === "design-reviewer") ok(n.skills?.some((p: any) => p.id === "visual-design-review"), `${d.id}/${n.id}: a design reviewer pins visual-design-review`, JSON.stringify(n.skills?.map((p: any) => p.id)));
    }
    if (n.kind === "hook" && MODEL_HOOKS[n.do]) ok(n.skills?.some((p: any) => p.id === MODEL_HOOKS[n.do]), `${d.id}/${n.id}: the ${n.do} hook (a model turn) pins ${MODEL_HOOKS[n.do]}`, JSON.stringify(n.skills?.map((p: any) => p.id)));
    ok(!badPins(n.skills).length, `${d.id}/${n.id}: every pin matches the built-in library text`, JSON.stringify(badPins(n.skills)));
    const refs = [...(n.checks ?? []), ...(d.edges ?? []).filter((e: any) => !Array.isArray(e) ? e.to === n.id : e[1] === n.id && e[3]).flatMap((e: any) => (Array.isArray(e) ? e[3]?.checks : e.checks) ?? [])];
    for (const ref of refs) { const man = manifest(ref.use); if (man?.kind !== "judged") continue; judges++;
      ok(duty(ref.skills).length > 0, `${d.id}/${n.id}: the judged check ${ref.use} pins a duty skill beyond plain-writing`, JSON.stringify(ref.skills?.map((p: any) => p.id)));
      if (man.judge?.role === "designer") ok(ref.skills?.some((p: any) => p.id === "visual-design-review"), `${d.id}/${n.id}: the design judge ${ref.use} pins visual-design-review`, JSON.stringify(ref.skills?.map((p: any) => p.id)));
      ok(!badPins(ref.skills).length, `${d.id}/${n.id}: ${ref.use}'s pins match the built-in library text`, JSON.stringify(badPins(ref.skills)));
    }
  }
}
ok(workflows >= 12 && agents >= 20 && judges >= 8, "the sweep covered the built-in workflows, their agent nodes and judged checks", JSON.stringify({ workflows, agents, judges }));

// the definitions load through the runtime's own validation with the library's hashes (a stale pin is an error there)
{
  const { WorkflowDefs, validate, normalize } = await import("../src/runtime/defs");
  const { Skills } = await import("../src/skills");
  const lib = new Skills(checkedTempDir("crew-duty-lib-"), { list: () => [], get: () => null, sourceSkill: () => null } as any);
  const info = (id: string, v: number) => { const s = lib.library().find((x: any) => x.id === id); return s && v === s.current ? { sha256: s.sha256, bytes: s.bytes } : null; };
  for (const f of files) { const d: any = parse(readFileSync(f, "utf8")); if (EXEMPT.has(d.id)) continue;
    const errs = validate(normalize(d), undefined, undefined, info).filter((x: any) => x.level === "error" && /skill|pinned|hash/.test(x.text));
    ok(!errs.length, `${d.id}: its skill pins validate against the library`, JSON.stringify(errs)); }
  // a check ref's pins are validated like a node's
  const bad = { id: "x", name: "x", version: 1, roles: [{ id: "r", label: "R", skill: "bundled:x" }], nodes: [{ id: "a", kind: "agent", label: "A", role: "r", mode: "m", checks: [{ use: "t/judge1", skills: [{ id: "code-review", v: 1, sha256: "0".repeat(64) }] }], x: 0, y: 0 }], edges: [] };
  ok(validate(bad as any, undefined, undefined, info).some((x: any) => x.level === "error" && /code-review v1: the hash does not match/.test(x.text)), "a check's stale skill pin is refused like a node's");
  const hookBad = { ...bad, nodes: [{ id: "h", kind: "hook", label: "H", do: "repo.cleanup", skills: [pin("plain-writing")], x: 0, y: 0 }] };
  ok(validate(hookBad as any, undefined, undefined, info).some((x: any) => x.level === "error" && /skills/.test(x.text)), "a hook that runs no model turn still pins no skills");
  void WorkflowDefs;
}

// ---------- what a stub agent and a judge actually receive: role, member, node; the check's own duty skills ----------
{
  const { installCrewGuard } = await import("../src/crew-guard");
  const roleText = "# Fixture designer role\n\nDesign the page.";
  const flow = { id: "fixture-duty", name: "Fixture duty", kind: "web", version: 1,
    roles: [{ id: "designer", label: "Designer", skill: "bundled:fixture-role", seat: "maker" }],
    nodes: [{ id: "a", kind: "agent", label: "A", role: "designer", mode: "test", skills: [pin("web-interaction"), pin("accessible-ui")],
      checks: [{ use: "t/judge1", blocking: false, skills: [pin("visual-design-review")] }], x: 0, y: 0 }],
    edges: [] };
  const h = await harness([Y(flow)], { data: checkedTempDir("crew-duty-rt-") }), e = h.engine;
  try {
    e.deps.skillText = (ref: string) => ref === "bundled:fixture-role" ? roleText : "# Test skill\n";
    e.modes.test.system = (_x: any, skill: string) => skill;
    const systems: { system: string; first: string }[] = [];
    const base = e.deps.provider;
    e.deps.provider = (id?: string, model?: string) => { const p = base(id, model);
      return { ...p, start: (system: string, tools: any, ctx: any) => { const s = p.start(system, tools, ctx); const rec = { system, first: "" }; systems.push(rec);
        return { ...s, interrupt: () => s.interrupt(), send: (text: string) => { if (!rec.first) rec.first = text.split("\n")[0]; return s.send(text); } }; } }; };
    const store = new C.CrewStore(h.data); installCrewGuard(e, store);
    const m = (provider: "codex" | "claude", model: string, effort: string | null, skills: any[] = []) => ({ provider, model, effort, skills });
    store.write({ schema: 1, members: { maker: m("codex", "gpt-6.1-sol", "medium", [pin("plain-writing")]), reviewer: m("claude", "opus-5.5", "high", [pin("code-review")]) }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" });
    const run = e.start({ workflow: flow.id, text: "a page" });
    const { until } = await import("./rt-harness");
    await until(() => ["succeeded", "failed"].includes(e.get(run.id)!.status), 60000);
    const turn = systems.find((s) => s.first.startsWith("TEST AGENT"));
    const at = (t: string) => turn?.system.indexOf(t) ?? -1;
    const order = [at(roleText), at("# Skill: plain-writing (v1)"), at(body("plain-writing")), at("# Skill: web-interaction (v1)"), at(body("web-interaction")), at("# Skill: accessible-ui (v1)"), at(body("accessible-ui"))];
    ok(!!turn && order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), "the agent's system text carries the role skill, then the member's skill, then the node's skills, in order", JSON.stringify(order));
    const judge = systems.find((s) => s.first.startsWith("JUDGE judge1"));
    ok(!!judge && judge.system.includes("# Skill: visual-design-review (v1)") && judge.system.includes(body("visual-design-review")) && judge.system.indexOf(roleText) < judge.system.indexOf(body("visual-design-review")),
      "the judge's system text carries its role skill, then its check's duty skill", judge?.system.slice(0, 400));
    ok(!judge?.system.includes(body("web-interaction")), "the judge does not inherit the maker node's skills");
    const step = e.get(run.id)!.steps.find((s: any) => s.node === "a") as any;
    ok(step?.judges?.[0]?.skills?.join() === "visual-design-review@v1", "the step lists the judge call's duty skills", JSON.stringify(step?.judges));
    const rec = e.trusted(run.id).entries.find((x: any) => x.record === "crew-resolved")?.data as any;
    ok(JSON.stringify(rec?.nodes?.a?.skills?.map((p: any) => `${p.id}:${p.from}`)) === JSON.stringify(["plain-writing:member", "web-interaction:node", "accessible-ui:node"]), "the run ledger records the final skills with where each comes from", JSON.stringify(rec?.nodes?.a?.skills));
    // the hooks that run a model turn load their own pins
    const hookDef: any = { ...flow, nodes: [...flow.nodes, { id: "pr", kind: "hook", label: "PR", do: "pr.open", skills: [pin("commit-and-pr-text"), pin("plain-writing")], x: 1, y: 0 }] };
    ok(e.nodePins({ id: "no-run", def: hookDef } as any, hookDef.nodes[1]).map((p: any) => p.id).join() === "commit-and-pr-text,plain-writing", "a pr.open hook's agent turn loads its own pins");
    ok(e.textPins({ id: "no-run", def: hookDef } as any, "pr.open").map((p: any) => p.id).join() === "commit-and-pr-text,plain-writing", "the pull request text is written with the pr.open hook's skills");
  } finally { h.stop(); }
}

// ---------- the Crew page and studio_crew_assignments name the role skill ----------
{
  const { crewView } = await import("../src/crew-routes");
  const { WorkflowDefs } = await import("../src/runtime/defs");
  const data = checkedTempDir("crew-duty-view-");
  const code = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8"), web = readFileSync(join(root, "workflows/v2/web-prototype.wf.yaml"), "utf8");
  const defs = new WorkflowDefs(data, () => [code, web]);
  const worker = readFileSync(join(root, "packs/firstmate/skills/worker.md"), "utf8");
  const roleSkill = (def: any, role: string | null) => { const r = def.roles?.find((x: any) => x.id === role); if (!r) return null; const text = r.skill === "pack:firstmate/skills/worker.md" ? worker : `# ${r.id}\n`; return { ref: r.skill, version: 3, sha256: sha(text) }; };
  const store = new C.CrewStore(data);
  const judges = (def: any) => def.id === "code-firstmate" ? [{ node: "spec", check: "firstmate/no-impl-detail", label: "Spec · no implementation detail", seat: "reviewer", role: "reviewer" }] : [];
  const v = crewView({ defs, store, facts: () => [], library: () => [], roleSkill, judges } as any);
  const build = v.workflows.find((w: any) => w.id === "code-firstmate")?.nodes.find((n: any) => n.node === "build");
  ok(build?.roleSkill?.ref === "pack:firstmate/skills/worker.md" && build.roleSkill.name === "worker.md" && build.roleSkill.version === 3 && build.roleSkill.sha256 === sha(worker),
    "the Crew page's build row names its role skill: worker.md, Studio's version and sha256", JSON.stringify(build?.roleSkill));
  ok(build?.skills?.some((p: any) => p.id === "fail-first-testing" && p.from === "node"), "the build row's own duty skills are listed as the node's", JSON.stringify(build?.skills));
  const jrow = v.workflows.find((w: any) => w.id === "code-firstmate")?.nodes.find((n: any) => n.judge);
  ok(jrow?.duty?.some((p: any) => p.id === "technical-writing") && jrow.roleSkill?.ref === "pack:firstmate/skills/reviewer.md", "a judge row names the role it judges as and its check's duty skills", JSON.stringify([jrow?.roleSkill, jrow?.duty]));
  const tools = readFileSync(join(root, "src/crew-tools.ts"), "utf8");
  ok(/const view=[\s\S]{0,400}roleSkill:roleLine/.test(tools), "studio_crew_assignments's per-node view names the role skill");
  const ui = readFileSync(join(root, "public/team.js"), "utf8");
  ok(/data-role-skill/.test(ui) && /"角色"/.test(ui), "the Crew page shows the role skill, labelled 角色", "");
}
end();
