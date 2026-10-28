// A repository's pull request template, filled without losing its shape: every heading
// stays, in order; the guidance comments give way to the coordinator's text; a test table
// (a table whose header names a test) gets one row per done line from Studio's own evidence;
// every checkbox stays, ticked only where Studio's evidence proves it. The template text is
// untrusted repository content: it shapes the body, it never grants anything.
import { createHash } from "node:crypto";

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

/** A done line's test file: the first test path it names. */
export const TEST_PATH = /(tests?\/[\w./-]+|[\w./-]+\.test\.\w+)/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SHORT = 200;
/** A done line as a reviewer reads it in the test table: the test file goes to its own column (the
 *  "In `file`," lead and a "(file)" aside leave cleanly), the spec's fail-first plan goes (the
 *  "Fails on" column says what Studio proved), code spans stay balanced, and a long line is cut at
 *  a word outside a code span. */
export function acceptanceRow(line: string): { done: string; test: string } {
  const src = String(line ?? "").replace(/\s+/g, " ").trim(), test = TEST_PATH.exec(src)?.[1] ?? "";
  let t = src;
  if (test) {
    const p = `\`?${esc(test)}\`?`;
    t = t.replace(new RegExp(`^(?:in|per|from)\\s+${p}\\s*[,:]\\s*`, "i"), "").replace(new RegExp(`\\s*\\(\\s*(?:in\\s+)?${p}\\s*\\)`, "gi"), "").replace(new RegExp(`\\s*(?:—|–|-|:)\\s*${p}\\s*$`), "");
  }
  // the spec's fail-first plan: an aside, a clause or a sentence of its own
  t = t.replace(/\s*\((?:planned\s+)?fail[- ]first\b[^)]*\)/gi, "")
    .split(/;\s+|(?<=\.)\s+(?=[A-Z])/).filter((c) => !/^(?:planned\s+)?fail[- ]first\b/i.test(c.trim())).join("; ");
  t = t.replace(/``/g, "").replace(/\s{2,}/g, " ").replace(/\(\s*\)/g, "").replace(/[\s;,:.–-]+$/, "").trim();
  if ((t.match(/`/g) ?? []).length % 2) t = t.replace(/`/g, "");
  if (t.length > SHORT) {
    let cut = -1, open = false;
    for (let i = 0; i < SHORT; i++) { if (t[i] === "`") open = !open; else if (t[i] === " " && !open) cut = i; }
    t = t.slice(0, cut > 40 ? cut : SHORT).replace(/[\s;,:.–-]+$/, "") + "…";
    if ((t.match(/`/g) ?? []).length % 2) t = t.replace(/`/g, "");
  }
  if (/^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  return { done: t || src, test: test || "—" };
}

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
/** A Task drawn from an issue triage leaves no trace on GitHub: any reference GitHub would link back to an issue, a pull
 *  request or a discussion (#n, GH-n, owner/repo#n; an issues, pull or discussions URL, with or without https:// or www.,
 *  or a relative issues/n path) becomes "an issue", and an @mention (@user, @org/team) loses its @, so its text neither
 *  closes an issue, nor cross-references one, nor notifies anyone. A #n counts wherever GitHub may link it: anywhere but
 *  right after a letter, a digit, "&", "/" or "#", so an HTML entity (&#123;) and a URL's anchor (file.ts#12) stay, and so
 *  does a CSS color after its property (color: #123456;). Code (a fenced block or an inline span) stays as written. The issues stay named in Studio's own records only. */
const LINK_URL = /(?:https?:\/\/|\bwww\.)[^\s)>\]]+?\/(?:issues|pulls?|discussions)\/\d+[^\s)>\]]*|(?<![\w/.-])(?:\.\.?\/)*(?:issues|pulls?|discussions)\/\d+\b/gi;
const SHORT_REF = /(?<![\w&\/#])(?:[\w.-]+\/[\w.-]+)?#\d+\b|(?<![\w-])GH-\d+\b/gi;
const CSS_COLOR = /\b(?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)*|outline)\s*:\s*$/i;
const MENTION = /(?<![\w`@.\/-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[\w.-]+)?)\b/g;
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;
export const withoutGitHubLinks = (text: string) => String(text ?? "").split(CODE).map((part, i) => i % 2 ? part
  : part.replace(LINK_URL, "an issue").replace(SHORT_REF, (m, at: number, all: string) => CSS_COLOR.test(all.slice(Math.max(0, at - 40), at)) ? m : "an issue").replace(MENTION, "$1")).join("");

/** Studio's part of a pull request body, between two hidden markers: the begin marker names the head the text describes and
 *  the hash of the text between them, so Studio can tell a text that lags the head, or that someone edited, from its own.
 *  Text outside the markers (a reviewer's note, a person's addition) belongs to whoever wrote it and stays as it is. */
const STUDIO_BEGIN = /<!-- crew-studio:pr-text head=([a-f0-9]{40}) hash=([a-f0-9]{64})[^>]*-->\n/;
const STUDIO_END = "<!-- /crew-studio:pr-text -->";
export const studioTextHash = (inner: string) => createHash("sha256").update(inner).digest("hex");
/** Studio's text wrapped in its markers (a marker line inside the text is dropped, so the text cannot fake one). */
export function wrapStudioText(inner: string, head: string): string {
  const t = String(inner ?? "").replace(/\r\n?/g, "\n").split("\n").filter((l) => !/crew-studio:pr-text/.test(l)).join("\n").trimEnd() + "\n";
  return `<!-- crew-studio:pr-text head=${head} hash=${studioTextHash(t)} (Studio writes the text between these markers; text outside them stays as it is) -->\n${t}${STUDIO_END}`;
}
export type StudioParts = { marked: boolean; before: string; inner: string; after: string; head: string | null; hash: string | null };
/** A body split at Studio's markers. No markers (a text an older release wrote): the whole body is the candidate part.
 *  A begin without its end, or more than one pair, is not Studio's shape: marked, with a hash nothing matches. */
export function studioParts(body: string): StudioParts {
  const b = String(body ?? "").replace(/\r\n?/g, "\n"), m = STUDIO_BEGIN.exec(b);
  if (!m && !b.includes(STUDIO_END)) return { marked: false, before: "", inner: b, after: "", head: null, hash: null };
  const end = m ? b.indexOf(STUDIO_END, m.index + m[0].length) : -1;
  if (!m || end < 0 || STUDIO_BEGIN.test(b.slice(end)) || b.indexOf(STUDIO_END, end + 1) >= 0) return { marked: true, before: "", inner: b, after: "", head: m?.[1] ?? null, hash: null };
  return { marked: true, before: b.slice(0, m.index), inner: b.slice(m.index + m[0].length, end), after: b.slice(end + STUDIO_END.length), head: m[1], hash: m[2] };
}
