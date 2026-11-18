// One source, three presentations (docs/units/observe.md "Index"): the rules in src/observe/instructions.ts (the server
// `instructions` every MCP client gets), the tool index in src/observe/catalog.ts and the kinds in the registry make
//   - the firstmate skill (skills/firstmate/SKILL.md, written by `bun scripts/observe-index.ts --write`; tests/observe-index.ts
//     fails when the file drifts from this),
//   - the index studio_manual returns with no section (src/manual.ts studioManual),
// so none of them is a copy to keep in step by hand. The coordinator skill of Studio's code runs
// (packs/firstmate/skills/firstmate.md) is a run procedure for another reader and stays its own file: it is pinned by the
// Tasks that ran with it, and it names no read tool.
import { IRON_RULES, READING_RULES, MANUAL_POINTER, OBSERVE_RULES } from "./instructions";
import { STUDIO_TOOLS, type ToolGroup } from "./catalog";
import { kindDefs } from "./registry";
import "./tools";

const GROUPS: Record<ToolGroup, string> = { observe: "See Studio", work: "Propose work", manual: "Manual and rules", projects: "Projects", staffing: "Staffing", drafts: "The captain's own workflows",
  questions: "Agents' questions", github: "GitHub", issues: "Issues", crew: "The crew" };

/** The index as data: what studio_manual {} returns next to the manual's own index page. */
export function studioIndex() {
  return {
    rules: { iron: [...IRON_RULES], reading: [...READING_RULES, ...OBSERVE_RULES] },
    kinds: kindDefs().map((d) => ({ kind: d.kind, ref: `${d.kind}:${d.idExample}`, page: d.route, list: d.listRoute, about: d.about })),
    tools: STUDIO_TOOLS.map((t) => ({ name: t.name, group: t.group, about: t.about, ...(t.always ? {} : { only: "where its example is installed" }) })),
  };
}

/** skills/firstmate/SKILL.md: the full index Firstmate's CLI loads (the server instructions are its short form). */
export function firstmateSkill(): string {
  const ix = studioIndex(), by = new Map<ToolGroup, typeof ix.tools>();
  for (const t of ix.tools) by.set(t.group as ToolGroup, [...(by.get(t.group as ToolGroup) ?? []), t]);
  return [
    "---",
    "name: firstmate",
    "description: How Firstmate works with the captain's Crew Studio through Studio's tools: the three iron rules, how to read what the tools return, the kinds of things Studio holds and every tool, by what it is for. Generated from src/observe/ (instructions.ts, catalog.ts, the registry) by scripts/observe-index.ts: edit those, never this file.",
    "---",
    "",
    "# Firstmate in Crew Studio",
    "",
    "Studio's MCP server sends the short form of this as its instructions. The operating manual (`studio_manual`) has the",
    "procedures; this is the index.",
    "",
    "## Iron rules",
    "",
    ...ix.rules.iron.map((r, i) => `${i + 1}. ${r}`),
    "",
    "## Reading Studio",
    "",
    ...ix.rules.reading.map((r) => `- ${r}`),
    `- ${MANUAL_POINTER}`,
    "",
    "## What Studio holds",
    "",
    "| Kind | Ref | Board page | What it is |",
    "| --- | --- | --- | --- |",
    ...ix.kinds.map((k) => `| \`${k.kind}\` | \`${k.ref}\` | \`${k.page}\` | ${k.about} |`),
    "",
    "## Tools",
    "",
    ...[...by].flatMap(([g, ts]) => [`### ${GROUPS[g]}`, "", ...ts.map((t) => `- \`${t.name}\`: ${t.about}${t.only ? ` (only ${t.only})` : ""}.`), ""]),
  ].join("\n");
}
