import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// The built-in skill library (captain: "這裡沒有多個skill可以選" — the node panel had only plain-writing to pick):
//   - a new data folder and an existing one that holds only plain-writing both get every built-in skill (packs/*/skills),
//     each a short, principled text with a description and where it fits; seeding again adds nothing;
//   - the captain's own copy of a built-in skill (imported under the same name) is its next version, and a later seed
//     never puts the built-in back over it;
//   - skillFit suggests a skill for the roles and outputs its fits name, and refuses a node kind outside them;
//   - Firstmate chooses from the library: the draft contract lists it, a draft and studio_update_workflow_staffing take
//     a node's skills as ordered ids (pinned at the current version), and refuse an unknown id;
//   - importing from a skills home works with a temp HOME holding ~/.claude/skills/<name>/SKILL.md.
//      bun tests/skill-library.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Skills, skillFit, splitFrontmatter } from "../src/skills";
import { gateHarness } from "./gate-harness";
import { WORKFLOW_DRAFT_EXAMPLE } from "../src/workflow-draft-contract";

let pass = 0, fail = 0;
const ok = (v: any, name: string, detail = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${name}${v ? "" : " " + detail}`); v ? pass++ : fail++; };
const flows = { list: () => [], get: () => null, sourceSkill: () => null } as any;
const root = join(import.meta.dir, "..");
const builtins = readdirSync(join(root, "packs/core/skills")).filter((d) => existsSync(join(root, "packs/core/skills", d, "SKILL.md")));

// ---------- a new data folder ----------
const fresh = checkedTempDir("crew-skill-library-fresh-");
const lib = new Skills(fresh, flows).library();
ok(lib.length >= 10 && builtins.every((id) => lib.some((s) => s.id === id && s.sourceKind === "builtin" && s.current === 1)), "a new data folder gets every built-in skill (at least 10), each v1", JSON.stringify(lib.map((s) => s.id)));
ok(lib.every((s) => s.description.trim().length > 20 && s.fits && (s.fits.roles?.length ?? 0) > 0), "every built-in skill has a one-line description and says where it fits", JSON.stringify(lib.filter((s) => !s.fits || !s.description).map((s) => s.id)));
const words = builtins.filter((id) => id !== "plain-writing").map((id) => [id, splitFrontmatter(readFileSync(join(root, "packs/core/skills", id, "SKILL.md"), "utf8")).body.split(/\s+/).filter(Boolean).length] as const);
ok(words.length >= 10 && words.every(([, n]) => n <= 160), "the new built-in skills are short (about 150 words at most)", JSON.stringify(words));
ok(new Skills(fresh, flows).library().every((s) => s.current === 1 && s.versions.length === 1), "seeding again adds no version");

// ---------- an existing data folder with only plain-writing ----------
const old = checkedTempDir("crew-skill-library-old-");
{ const first = new Skills(old, flows).library(); const pw = first.find((s) => s.id === "plain-writing")!;
  for (const d of readdirSync(join(old, "skills", "_library"))) if (d !== "plain-writing") rmSync(join(old, "skills", "_library", d), { recursive: true, force: true });
  ok(readdirSync(join(old, "skills", "_library")).join() === "plain-writing", "the old folder holds only plain-writing");
  const now = new Skills(old, flows).library(); const pw2 = now.find((s) => s.id === "plain-writing")!;
  ok(now.length >= 10 && builtins.every((id) => now.some((s) => s.id === id)), "an existing data folder with only plain-writing gets the rest of the library on startup", JSON.stringify(now.map((s) => s.id)));
  ok(pw2.current === 1 && pw2.sha256 === pw.sha256 && pw2.versions.length === 1, "plain-writing keeps its v1 and hash (pins on it stay valid)"); }

// ---------- the captain's own version of a built-in skill ----------
{ const data = checkedTempDir("crew-skill-library-captain-"); const S = new Skills(data, flows); const before = S.library().find((s) => s.id === "code-review")!;
  const mine = join(checkedTempDir("crew-skill-library-src-"), "code-review"); mkdirSync(mine, { recursive: true });
  writeFileSync(join(mine, "SKILL.md"), "---\nname: code-review\ndescription: The captain's own review rules\n---\n\nCAPTAIN REVIEW RULES\n");
  let r: any = null, err = ""; try { r = S.importFolder(mine, "captain"); } catch (e: any) { err = e.message; }
  ok(r?.created && r.version.n === 2 && r.version.sourceKind === "folder", "importing the captain's own code-review makes v2 of the built-in (the captain's edit)", err || JSON.stringify(r?.version));
  const later = new Skills(data, flows).library().find((s) => s.id === "code-review")!;
  ok(later.current === 2 && later.sourceKind === "folder" && later.versions.length === 2 && later.versions[0].sha256 === before.sha256, "a later startup never puts the built-in back over the captain's version", JSON.stringify(later.versions));
  const S2 = new Skills(data, flows); ok(S2.body("code-review", 2, later.sha256).includes("CAPTAIN REVIEW RULES"), "the captain's version is the text a pin on v2 gets"); }

// ---------- fits: suggestions and the kind check ----------
{ const by = (id: string) => lib.find((s) => s.id === id)!.fits;
  ok(skillFit(by("code-review"), { kind: "agent", role: { id: "reviewer", label: "Reviewer" } }) >= 2 && skillFit(by("code-review"), { kind: "agent", role: { id: "designer", label: "Designer" } }) === 1,
    "code-review is suggested for a reviewer and only allowed for a designer");
  ok(skillFit(by("accessible-ui"), { kind: "agent", role: { id: "developer" }, format: "web" }) >= 3, "accessible-ui is suggested for a developer's web page (role and output)");
  ok(skillFit(by("film-direction"), { kind: "check" }) === 0 && skillFit(null, { kind: "agent" }) === 1, "a skill never fits a node kind outside its kinds; a skill with no fits goes on any agent node"); }

// ---------- Firstmate chooses from the library ----------
const h: any = gateHarness({ skills: true });
try {
  const contract = await h.tool("studio_workflow_draft_contract", {});
  ok(Array.isArray(contract.library) && contract.library.length >= 10 && contract.library.every((s: any) => s.id && s.v >= 1 && s.description) && contract.library.find((s: any) => s.id === "code-review")?.fits?.roles?.includes("reviewer"),
    "the draft contract lists the library with id, version, description and fits", JSON.stringify(contract.library?.slice?.(0, 2)));
  const draft = structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any; draft.workflow.nodes[1].skills = ["web-interaction", "accessible-ui"];
  const d = await h.tool("studio_draft_workflow", draft);
  const make = d.draft ? h.rt.drafts.get(d.draft).def.nodes.find((n: any) => n.id === "make") : null;
  ok(JSON.stringify(make?.skills?.map((p: any) => `${p.id}@v${p.v}`)) === '["web-interaction@v1","accessible-ui@v1"]' && make.skills.every((p: any) => p.sha256 && p.sha256 === h.rt.defs.skillInfo(p.id, p.v)?.sha256),
    "a drafted node's skills are pinned in order at the library's current version", JSON.stringify(d).slice(0, 300) + JSON.stringify(make?.skills));
  const bad = structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any; bad.workflow.nodes[1].skills = ["no-such-skill"];
  const refused = await h.tool("studio_draft_workflow", bad);
  ok(refused.code === "draft_invalid" && /not in the skill library/.test(JSON.stringify(refused)), "an unknown library skill id is refused", JSON.stringify(refused).slice(0, 300));
  const onCard = structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any; onCard.workflow.nodes[0].skills = ["code-review"];
  ok((await h.tool("studio_draft_workflow", onCard)).code === "draft_invalid", "a card node takes no library skills");
  const saved = await h.tool("studio_save_workflow_draft", { draft: d.draft });
  const wf = saved.workflow; const read = await h.tool("studio_read_workflow", { workflow: wf });
  ok(Array.isArray(read.skillLibrary) && read.skillLibrary.length >= 10, "studio_read_workflow lists the library to choose from");
  const up = await h.tool("studio_update_workflow_staffing", { workflow: wf, base: read.workflow.version, nodes: [{ node: "make", skills: ["accessible-ui", "code-review"] }] });
  const after = h.rt.defs.get(wf).nodes.find((n: any) => n.id === "make");
  ok(up.status === "saved-no-task" && up.version === read.workflow.version + 1 && JSON.stringify(after.skills.map((p: any) => p.id)) === '["accessible-ui","code-review"]',
    "studio_update_workflow_staffing sets a node's library skills in order as a new version", JSON.stringify(up));
  ok(JSON.stringify(h.rt.defs.get(wf).diff?.skills) === JSON.stringify([{ node: "make", before: ["web-interaction@v1", "accessible-ui@v1"], after: ["accessible-ui@v1", "code-review@v1"] }]), "the new version's diff names the node's skill change", JSON.stringify(h.rt.defs.get(wf).diff));
  const off = await h.tool("studio_update_workflow_staffing", { workflow: wf, base: up.version, nodes: [{ node: "make", skills: [] }] });
  ok(off.status === "saved-no-task" && !h.rt.defs.get(wf).nodes.find((n: any) => n.id === "make").skills, "skills: [] turns a node's library skills off");
} catch (e: any) { ok(false, "firstmate library suite", e?.stack ?? String(e)); }

// ---------- import from a skills home with a temp HOME ----------
{ const home = checkedTempDir("crew-skill-library-home-"); const dir = join(home, ".claude", "skills", "my-notes"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: my-notes\ndescription: The captain's own note rules\n---\n\nNOTES BODY\n");
  const S = new Skills(checkedTempDir("crew-skill-library-homedata-"), flows);
  const listed = S.homes(home).find((x) => x.id === "claude");
  ok(listed?.exists && listed.skills.some((s) => s.dir === "my-notes" && s.description === "The captain's own note rules"), "the ~/.claude/skills home lists the fake skill", JSON.stringify(listed));
  const r = S.importHome("claude", "my-notes", "captain", home);
  ok(r.created && r.version.sourceKind === "home" && r.version.source === "~/.claude/skills/my-notes" && S.library().some((s) => s.id === "my-notes") && S.library().length >= 11, "importing from ~/.claude/skills adds it beside the built-in library", JSON.stringify(r.version)); }

console.log(`\nskill-library: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
