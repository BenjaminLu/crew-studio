// The operating manual (manual/<workflow>/<role>.md, manual/index.md): the procedure each shipped workflow and role
// follows, bundled like the skills (src/bundled.gen.ts). Firstmate reads it with studio_manual; every agent brief
// carries the matching page's sections (src/brief-skeleton.ts). A section id is the page path without ".md".
import { bundledList, bundledText } from "./bundled";

const PREFIX = "manual/";
/** Every page id, e.g. "code-firstmate/worker" (the index is "index"). */
export const manualIds = (): string[] => bundledList(PREFIX).filter((p) => p.endsWith(".md")).map((p) => p.slice(PREFIX.length, -3));
/** One page's Markdown, or null when there is no such page (ids are plain path segments only). */
export function manualPage(id: string): string | null {
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(id)) return null;
  return bundledText(`${PREFIX}${id}.md`);
}
/** The body of one `## <heading>` of a page (case-insensitive), trimmed; null when the page or heading is absent. */
export function manualSection(id: string, heading: string): string | null {
  const t = manualPage(id); if (!t) return null;
  const lines = t.split("\n"); const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^##?\s/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n").trim() || null;
}
/** The page for a workflow step: <workflow>/<role>, else <workflow>/overview, else the fallback (studio/agents). */
export function manualFor(workflow: string, role: string | null | undefined, fallback = "studio/agents"): string {
  const ids = new Set(manualIds());
  return [role ? `${workflow}/${role}` : null, `${workflow}/overview`].find((c) => c && ids.has(c)) ?? (ids.has(fallback) ? fallback : "studio/agents");
}
/** What studio_manual returns: the index and the page list without a section, else the page (or the valid ids). */
export function studioManual(section?: unknown): { section: string; text: string; sections: string[] } | { error: string; sections: string[] } {
  const sections = manualIds().filter((s) => s !== "index");
  if (section === undefined || section === null || section === "" || section === "index") return { section: "index", text: manualPage("index") ?? "", sections };
  if (typeof section !== "string") return { error: "section is a page id such as code-firstmate/worker", sections };
  const id = section.trim().replace(/^manual\//, "").replace(/\.md$/, "");
  const text = manualPage(id);
  return text ? { section: id, text, sections } : { error: `no manual section ${JSON.stringify(section)}; use one of the listed sections`, sections };
}
