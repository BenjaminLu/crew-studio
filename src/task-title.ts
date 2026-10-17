// A Task's short title: the name the board, inbox, cards and run page show. The captain's full request stays in
// run.text (the Task page's intent section, the cards' INTENT section, tooltips); the title is only a name.
// Budget: 48 width units, a CJK or full-width character counting 2 (so ≤ 24 CJK or ≤ 48 Latin characters).
export const TITLE_WIDTH = 48;

const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u;
const URL_RE = /\b[a-z][\w+.-]*:\/\/\S+/gi;
// an absolute, home or relative path (/Users/x/y, ~/x, ./x, ../x, C:\x): a run of path characters up to a space or clause mark
const PATH_RE = /[\w.-]+(?:\/[\w.-]+){2,}|(?:^|(?<=[\s（(「『"'“‘：:，,]))(?:~|\.{1,2})?[\/\\](?:[^\s，。,；;：（）()「」『』"'“”‘’]*)|(?:^|(?<=\s))[A-Za-z]:\\[^\s，。,；;（）()「」]*/g;
const PAREN_RE = /（[^（）]*）|\([^()]*\)/g;
// the first clause ends at a full stop, comma, colon, semicolon, question/exclamation mark or newline;
// a Latin "." only ends it before a space or the end (so "Node.js" and "v2.1" stay whole)
const CLAUSE_END = /[。，,：:；;！？!?\n\r]|\.(?=\s|$)/;
const EDGE = /^[\s#>*\-–—•·、，。,.;；:：!?！？…]+|[\s#>*\-–—•·、，。,.;；:：!?！？]+$/g;

export const titleWidth = (s: string): number => { let w = 0; for (const ch of s) w += WIDE.test(ch) ? 2 : 1; return w; };
export const hasPath = (s: string): boolean => new RegExp(URL_RE.source, "i").test(s) || new RegExp(PATH_RE.source).test(s);

/** Fit a title into the budget: whitespace collapsed, edge punctuation dropped, cut with … when too wide. Idempotent. */
export function clampTitle(s: unknown, width = TITLE_WIDTH): string {
  const t = String(s ?? "").replace(/\s+/g, " ").replace(EDGE, "");
  if (titleWidth(t) <= width) return t;
  let out = "", w = 0;
  for (const ch of t) { const cw = WIDE.test(ch) ? 2 : 1; if (w + cw > width - 1) break; out += ch; w += cw; }
  return out.replace(EDGE, "") + "…";
}

/** A short title derived from a request, deterministically: paths/URLs and asides removed, its first clause, clamped. */
export function deriveTitle(text: unknown): string {
  const raw = String(text ?? "");
  const clean = raw.replace(URL_RE, " ").replace(PATH_RE, " ").replace(PAREN_RE, "");
  const clauses = clean.split(CLAUSE_END).map((c) => c.replace(/\s+/g, " ").replace(EDGE, "")).filter(Boolean);
  return clampTitle(clauses[0] ?? "");
}

/** Already a short title: one line, no path or URL, within the budget. */
export const isShortTitle = (s: unknown): boolean => { const t = String(s ?? ""); return !!t.trim() && !/[\n\r]/.test(t) && !hasPath(t) && titleWidth(t) <= TITLE_WIDTH; };

/** The title to show for a run. A run recorded before short titles keeps its signed record; its name is derived on read. */
export function taskTitle(run: { title?: unknown; text?: unknown } | null | undefined): string {
  const title = String(run?.title ?? "");
  if (isShortTitle(title)) return title;
  return deriveTitle(title) || deriveTitle(run?.text) || clampTitle(title);
}
