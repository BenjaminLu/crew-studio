import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// One source, three presentations (docs/units/observe.md "Index"): the server instructions (src/observe/instructions.ts), the
// firstmate skill (skills/firstmate/SKILL.md) and studio_manual's index all carry the same rules, kinds and tools, made from
// src/observe/; the skill file is what scripts/observe-index.ts writes; the manual has pages for the review room and the
// pull request list; the seed's behavioural rules are untouched.
//      bun tests/observe-index.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite } from "./rt-harness";
import { SERVER_INSTRUCTIONS, IRON_RULES, READING_RULES, OBSERVE_RULES, OBSERVE_KINDS, KINDS_LINE } from "../src/observe/instructions";
import { nativeFreshText } from "../src/host/main";
import { firstmateSkill, studioIndex } from "../src/observe/guide";
import { kinds } from "../src/observe/registry";
import { STUDIO_TOOLS } from "../src/observe/catalog";
import { studioManual, manualPage } from "../src/manual";
import { installFirstmate } from "../src/firstmate";
import { harness } from "./rt-harness";
import { Projects } from "../src/doors";
const { ok, end } = suite("observe-index");
const root = join(import.meta.dir, "..");

const skill = readFileSync(join(root, "skills", "firstmate", "SKILL.md"), "utf8");
ok(skill === firstmateSkill(), "skills/firstmate/SKILL.md is what scripts/observe-index.ts writes (run it with --write)");
ok(/^---\nname: firstmate\ndescription: .+\n---\n/.test(skill), "it is a skill: name and description front matter");
const rules = [...IRON_RULES, ...READING_RULES, ...OBSERVE_RULES];
ok(rules.every((r) => SERVER_INSTRUCTIONS.includes(r) && skill.includes(r)), "every rule is in the server instructions and in the skill, word for word");
ok(J(OBSERVE_KINDS) === J(kinds()) && kinds().every((k) => SERVER_INSTRUCTIONS.includes(k) && skill.includes("`" + k + "`")), "the kinds the instructions name are the registry's, and the skill lists each", J([OBSERVE_KINDS, kinds()]));
ok(Buffer.byteLength(SERVER_INSTRUCTIONS) <= 4096, "the instructions stay within 4 KB", String(Buffer.byteLength(SERVER_INSTRUCTIONS)));
const seed = nativeFreshText("/ws");
ok([...READING_RULES, ...OBSERVE_RULES, KINDS_LINE].every((r) => seed.includes(r)) && /do not guess/.test(seed), "the fresh primary's seed (all Codex sees) carries every reading and read-tool rule from the same source", "");
ok(/Report status only from the turn's live status line or studio_work_status, never from memory/.test(seed) && /Proposing is not approval/.test(seed), "and keeps its behavioural rules");
ok(STUDIO_TOOLS.every((t) => skill.includes("`" + t.name + "`")), "the skill names every tool in the index");
// the plug-in kit's generated files: the studio skill and the tools reference page, made from the same source
{ const { GENERATED } = await import("../scripts/observe-index");
  const drift = GENERATED.filter((g) => { try { return readFileSync(g.path, "utf8") !== g.text(); } catch { return true; } }).map((g) => g.path.slice(root.length + 1));
  ok(!drift.length, "every generated file (firstmate skill, studio plug-in skill, tools reference) is what scripts/observe-index.ts writes", J(drift));
  const studio = readFileSync(join(root, "plugins/crew-studio/skills/studio/SKILL.md"), "utf8"), ref = readFileSync(join(root, "docs/reference/studio-tools.md"), "utf8");
  const { OBSERVE_TOOLS } = await import("../src/observe/tools");
  ok(/^---\nname: studio\ndescription: .+\n---\n/.test(studio) && IRON_RULES.every((r) => studio.includes(r)) && OBSERVE_TOOLS.every((t) => studio.includes("`" + t + "`") && ref.includes("## `" + t + "`")), "the studio skill carries the iron rules and every read tool; the reference page has a section per tool");
  ok(!/\| `(settings|peer|terminal)` \| `/.test(studio), "the studio skill lists no never-grantable kind");
  // the skill describes the tools a real grant lists: the same names and first sentences, and nothing a grant cannot reach
  const { createObserve } = await import("../src/observe/tools"), { grantableKinds } = await import("../src/observe/grant-scope");
  const real = createObserve({ engine: null } as any, { id: "g-00000000", kinds: grantableKinds(), project: null, untrusted: false }).specs;
  const toolsPart = studio.slice(studio.indexOf("## Tools")), kindsPart = studio.slice(studio.indexOf("## Kinds"), studio.indexOf("## Grant presets"));
  ok(real.every((t) => toolsPart.includes("`" + t.name + "` ") && toolsPart.includes(t.description.split(". ")[0])) && (toolsPart.match(/^- `/gm) ?? []).length === real.length, "the studio skill's tools are what a grant's tools/list returns, word for word");
  ok(!/terminal|settings|peer|looking at/i.test(toolsPart + kindsPart), "its tools and kinds say nothing of terminals, settings, peers or the captain's focus");
  ok(/Under an external CLI grant: What needs the captain now, within this grant/.test(ref), "the reference page says how each tool differs under a grant"); }

// studio_manual {}: the manual's index page, its page list, and the same index as data
const H = await harness([readFileSync(join(root, "workflows/v2/firstmate-proposal.wf.yaml"), "utf8")]);
try {
  const tools = installFirstmate(H.engine, new Projects(H.data));
  const ix: any = await tools.call("studio_manual", {}, { key: "k", captain: true, text: "x", live: () => true });
  ok(ix.section === "index" && typeof ix.text === "string" && J(ix.studio) === J(studioIndex()), "studio_manual {} returns the manual's index and the same rules, kinds and tools", J(Object.keys(ix)));
  ok(rules.every((r) => J(ix.studio.rules).includes(J(r).slice(1, -1))), "with every rule");
  ok(ix.sections.includes("studio/pages/review-room") && ix.sections.includes("studio/pages/prs"), "the manual lists the review room's and the pull request list's pages", J(ix.sections));
  const room = studioManual("studio/pages/review-room") as any, prs = studioManual("studio/pages/prs") as any;
  ok(/## Briefing/.test(room.text) && /studio_get \{ref: "room:<id>"\}/.test(room.text) && /never starts, prepares or pre-fills/.test(room.text), "the review room page says what a room holds, how to read it, and that Firstmate starts nothing paid");
  ok(/## Briefing/.test(prs.text) && /waitsAt/.test(prs.text) && /Nothing here writes to GitHub/.test(prs.text), "the pull request page says where a merged one waits and that nothing writes to GitHub");
  ok(/studio\/pages\/review-room/.test(manualPage("index") ?? "") && /studio\/pages\/prs/.test(manualPage("index") ?? ""), "the manual's index names both pages");
} finally { H.stop(); }
function J(v: unknown) { return JSON.stringify(v); }
end();
