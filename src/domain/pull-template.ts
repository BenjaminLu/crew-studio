// A repository's pull request template, filled without losing its shape: every heading
// stays, in order; the guidance comments give way to the coordinator's text; a test table
// (a table whose header names a test) gets one row per done line from Studio's own evidence;
// every checkbox stays, ticked only where Studio's evidence proves it. The template text is
// untrusted repository content: it shapes the body, it never grants anything.

export type TemplateCheckbox = { text: string };
export type TemplateTable = { header: string[]; headerLine: string; sepLine: string; rows: string[]; tests: boolean };
export type TemplateSection = { heading: string | null; headingLine: string | null; guidance: string[]; prose: string[]; table: TemplateTable | null; checkboxes: TemplateCheckbox[]; order: ("prose" | "table" | "checkboxes")[] };
export type TestRow = { done: string; test: string; failsOnBase: string };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

export function parsePullTemplate(text: string): TemplateSection[] {
  const guidance: string[] = [];
  // HTML comments are the template's guidance: kept per section for the writer, not in the body
  const src = String(text ?? "").replace(/\r\n?/g, "\n").replace(/<!--([\s\S]*?)-->/g, (_m, g) => `\u0000${guidance.push(String(g).trim()) - 1}\u0000`);
  const out: TemplateSection[] = []; let cur: TemplateSection = { heading: null, headingLine: null, guidance: [], prose: [], table: null, checkboxes: [], order: [] };
  const mark = (s: TemplateSection, k: "prose" | "table" | "checkboxes") => { if (!s.order.includes(k)) s.order.push(k); };
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    l = l.replace(/\u0000(\d+)\u0000/g, (_m, n) => { cur.guidance.push(guidance[Number(n)]); return ""; });
    const h = HEADING.exec(l);
    if (h) { out.push(cur); cur = { heading: h[2].trim(), headingLine: l.trim(), guidance: [], prose: [], table: null, checkboxes: [], order: [] }; continue; }
    const c = CHECKBOX.exec(l); if (c) { cur.checkboxes.push({ text: c[2] }); mark(cur, "checkboxes"); continue; }
    if (/^\s*\|/.test(l) && !cur.table && isSep(lines[i + 1] ?? "")) {
      const header = cells(l), rows: string[] = []; let j = i + 2;
      for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) if (cells(lines[j]).some((x) => x)) rows.push(lines[j].trim());
      cur.table = { header, headerLine: l.trim(), sepLine: lines[i + 1].trim(), rows, tests: header.some((x) => /test/i.test(x)) }; mark(cur, "table"); i = j - 1; continue;
    }
    if (/^\s*[-*]\s*$/.test(l) || !l.trim()) continue; // an empty bullet is a placeholder
    cur.prose.push(l); mark(cur, "prose");
  }
  out.push(cur);
  return out.filter((s) => s.heading !== null || s.prose.length || s.table || s.checkboxes.length);
}

/** A section the writer must fill: it is not only checkboxes or a Studio-filled test table. */
export const needsText = (s: TemplateSection) => s.heading !== null && !(s.checkboxes.length && !s.guidance.length && !s.prose.length && !s.table) && !(s.table?.tests && !s.guidance.length && !s.prose.length && !s.checkboxes.length);

const cell = (s: string) => String(s ?? "").replace(/\s+/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim() || "—";
function testRows(t: TemplateTable, rows: TestRow[]): string[] {
  const col = (h: string): keyof TestRow | null => /fail|red|broke|main|base/i.test(h) ? "failsOnBase" : /accept|done|criteri|requirement|behaviou?r|line|case/i.test(h) ? "done" : /test/i.test(h) ? "test" : null;
  const map = t.header.map(col);
  return rows.map((r) => `| ${map.map((k) => cell(k ? r[k] : "")).join(" | ")} |`);
}

/** The body: the template's headings in order, each section's text, its table (test rows from Studio), its checkboxes ticked only when proven. */
export function renderPullBody(sections: TemplateSection[], o: { text: Record<string, string>; rows: TestRow[]; proven: Set<string> }): string {
  const parts: string[] = [];
  for (const s of sections) {
    const block: string[] = [];
    if (s.headingLine) block.push(s.headingLine, "");
    const text = s.heading !== null ? String(o.text[s.heading] ?? "").trim() : "";
    if (s.prose.length) block.push(...s.prose, "");
    if (text) block.push(text, "");
    for (const k of s.order) {
      if (k === "table" && s.table) { block.push(s.table.headerLine, s.table.sepLine, ...(s.table.tests && o.rows.length ? testRows(s.table, o.rows) : s.table.rows.length ? s.table.rows : [`|${s.table.header.map(() => "  |").join("")}`]), ""); }
      if (k === "checkboxes") { block.push(...s.checkboxes.map((c) => `- [${o.proven.has(c.text) ? "x" : " "}] ${c.text}`), ""); }
    }
    parts.push(block.join("\n").trimEnd());
  }
  return parts.filter(Boolean).join("\n\n") + "\n";
}

/** The body keeps the template: every heading in order, every checkbox (ticked only if proven). Returns why not, or null. */
export function templateShapeProblem(templateText: string, body: string, proven: Iterable<string>): string | null {
  const t = parsePullTemplate(templateText), b = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  let at = 0;
  for (const s of t) {
    if (s.headingLine) { const i = b.findIndex((l, k) => k >= at && l.trim() === s.headingLine); if (i < 0) return `the template heading "${s.heading}" is missing or out of order`; at = i + 1; }
  }
  const ok = new Set(proven);
  for (const s of t) for (const c of s.checkboxes) {
    const hit = b.map((l) => CHECKBOX.exec(l)).find((m) => m && m[2] === c.text);
    if (!hit) return `the template checkbox "${c.text}" is missing`;
    if (hit[1] !== " " && !ok.has(c.text)) return `the template checkbox "${c.text}" is ticked without evidence`;
  }
  return null;
}

/** Whether the template is written in a language other than English (it then sets the PR text's language). */
export const templateLanguage = (text: string) => ((String(text).match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length > 10 ? "the language the template is written in" : "English");

/** A claude.ai session link or a Claude-Session trailer never goes into text Studio pushes to GitHub (commit messages, pull request titles and bodies). */
export const SESSION_LINK = /claude\.ai\/code\/session|Claude-Session:/i;
export const withoutSessionLinks = (text: string) => String(text ?? "").split("\n").filter((l) => !SESSION_LINK.test(l)).join("\n");
