// Pull requests (docs/units/pr-watch.md): the deterministic part. Everything here is a pure function of what GitHub
// answered and the captain's settings: parsing the addresses the captain pastes, reading a test verdict from a comment,
// the approvals the branch rules still miss, the next step and who it waits on, the dependency block Studio writes into a
// pull request body, and the proposed order. No model, no network, no clock (callers pass the time).

export const NAME = /^[A-Za-z0-9_.-]+$/;
export const PR_ID = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d{0,9})$/;
const okName = (s: string) => NAME.test(s) && s !== "." && s !== ".." && s.length <= 100;
export const repoOk = (repo: string) => { const [o, r, ...rest] = String(repo ?? "").split("/"); return !rest.length && !!o && !!r && okName(o) && okName(r); };
export const prId = (repo: string, n: number) => `${repo}#${n}`;
export const splitId = (id: string): { repo: string; number: number } | null => { const m = PR_ID.exec(String(id ?? "")); return m && repoOk(m[1]) ? { repo: m[1], number: Number(m[2]) } : null; };
export const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type Parsed = { kind: "repo"; repo: string } | { kind: "pr"; repo: string; number: number } | { kind: "error"; error: string; tw: string };
/** A github.com repository or pull request address, strictly: https, github.com, owner/repo[/pull/<n>[/files|commits|checks]]. */
export function parseGitHubUrl(input: unknown): Parsed {
  const bad = (en: string, tw: string): Parsed => ({ kind: "error", error: en, tw });
  const s = String(input ?? "").trim();
  if (!s || s.length > 300) return bad("Paste a GitHub repository or pull request address", "請貼上 GitHub repo 或 pull request 網址");
  let u: URL; try { u = new URL(s); } catch { return bad("That is not an address: paste https://github.com/<owner>/<repo> or …/pull/<n>", "這不是網址：請貼 https://github.com/<owner>/<repo> 或 …/pull/<n>"); }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "github.com" || u.port || u.username || u.password)
    return bad("Only https://github.com addresses are accepted", "只接受 https://github.com 的網址");
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length < 2) return bad("The address names no repository: https://github.com/<owner>/<repo>", "網址沒有指出 repo：https://github.com/<owner>/<repo>");
  const owner = seg[0], repo = seg[1].replace(/\.git$/i, "");
  if (!okName(owner) || !okName(repo)) return bad("The owner or repository name has characters GitHub does not use", "owner 或 repo 名稱含有 GitHub 不使用的字元");
  if (seg.length === 2) return { kind: "repo", repo: `${owner}/${repo}` };
  if (seg[2] === "pull" && seg.length >= 4 && seg.length <= 5 && /^[1-9]\d{0,9}$/.test(seg[3]) && (seg.length === 4 || ["files", "commits", "checks"].includes(seg[4])))
    return { kind: "pr", repo: `${owner}/${repo}`, number: Number(seg[3]) };
  return bad("Only a repository (https://github.com/<owner>/<repo>) or a pull request (…/pull/<n>) can be watched", "只能追蹤 repo（https://github.com/<owner>/<repo>）或 pull request（…/pull/<n>）");
}

// ---------- links in a pull request body ----------
export type IssueRef = { repo: string; number: number };
/** Every github.com issue address in a text, in any repository (pull request addresses are not issues). */
export function issueLinks(text: string): IssueRef[] {
  const out: IssueRef[] = [], seen = new Set<string>();
  for (const m of String(text ?? "").slice(0, 65536).matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9]\d{0,9})\b/g)) {
    const repo = `${m[1]}/${m[2]}`; if (!repoOk(repo)) continue; const k = `${repo.toLowerCase()}#${m[3]}`; if (seen.has(k)) continue; seen.add(k); out.push({ repo, number: Number(m[3]) });
  }
  return out;
}
/** Pull requests a text names: full addresses, owner/repo#n, and #n (same repository as `repo`). */
export function prMentions(text: string, repo: string, opts: { bare?: boolean } = {}): string[] {
  const out: string[] = [], add = (r: string, n: string) => { if (repoOk(r)) { const id = prId(r, Number(n)); if (!out.some((x) => x.toLowerCase() === id.toLowerCase())) out.push(id); } };
  const t = String(text ?? "").slice(0, 65536);
  for (const m of t.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d{0,9})\b/g)) add(`${m[1]}/${m[2]}`, m[3]);
  for (const m of t.matchAll(/(?:^|[\s(,;])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d{0,9})\b/g)) add(m[1], m[2]);
  if (opts.bare !== false) for (const m of t.matchAll(/(?:^|[\s(,;])#([1-9]\d{0,9})\b/g)) add(repo, m[1]);
  return out;
}
/** `Depends-on:` lines (any number, comma separated) outside Studio's own block. */
export function dependsOnLines(body: string, repo: string): string[] {
  const out: string[] = [];
  for (const m of stripBlock(body).matchAll(/^[ \t>*-]*depends[- ]on\s*:\s*(.+)$/gim)) for (const id of prMentions(m[1], repo)) if (!out.includes(id)) out.push(id);
  return out;
}

// ---------- Studio's dependency block ----------
export const BLOCK_START = "<!-- crew-studio:depends -->", BLOCK_END = "<!-- /crew-studio:depends -->";
/** The longest block Studio writes or replaces (the card shows the block GitHub has whole). */
export const BLOCK_MAX = 4000;
export function renderBlock(on: string[], repo: string, shortForm = false): string {
  const lines = on.map((id) => { const s = splitId(id)!; return `Depends-on: https://github.com/${s.repo}/pull/${s.number}`; });
  if (shortForm) for (const id of on) { const s = splitId(id)!; if (sameRepo(s.repo, repo)) lines.push(`Depends-on: #${s.number}`); }
  return [BLOCK_START, ...lines, BLOCK_END].join("\n");
}
/** Studio's block in a body: its text (markers included), or null when there is none; "malformed" when a marker is unpaired. */
export function findBlock(body: string): { text: string; start: number; end: number } | null | "malformed" {
  const b = String(body ?? ""), s = b.indexOf(BLOCK_START), e = s < 0 ? b.indexOf(BLOCK_END) : b.indexOf(BLOCK_END, s);
  if (s < 0 && e < 0) return null;
  if (s < 0 || e < 0 || b.indexOf(BLOCK_START, s + 1) >= 0 && b.indexOf(BLOCK_START, s + 1) < e) return "malformed";
  return { text: b.slice(s, e + BLOCK_END.length), start: s, end: e + BLOCK_END.length };
}
export const stripBlock = (body: string) => { const f = findBlock(body); return f && f !== "malformed" ? body.slice(0, f.start) + body.slice(f.end) : String(body ?? ""); };
/** Why Studio may not replace the block a body has: unpaired markers, two blocks, or a block holding anything but
 *  Depends-on lines (a marker pair around other text would delete that text unseen). null when it may. */
export function blockProblem(body: string): string | null {
  const b = String(body ?? ""), f = findBlock(b);
  if (f === "malformed") return "the pull request body has an unpaired crew-studio:depends marker; fix it on GitHub first";
  if (!f) return null;
  if (b.indexOf(BLOCK_START, f.end) >= 0 || b.indexOf(BLOCK_END, f.end) >= 0) return "the pull request body has more than one crew-studio:depends block; fix it on GitHub first";
  // the card shows the block GitHub has now before it is replaced: so it must be short enough to show whole, and hold
  // nothing but Depends-on lines naming pull requests (anything else would be replaced unseen)
  if (f.text.length > BLOCK_MAX) return `the crew-studio:depends block in the body is over ${BLOCK_MAX} characters; fix it on GitHub first`;
  const inner = f.text.slice(BLOCK_START.length, f.text.length - BLOCK_END.length).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ref = /^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d{0,9}|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d{0,9}|#[1-9]\d{0,9})$/;
  const onlyRefs = (l: string) => { const m = /^depends[- ]on\s*:\s*(.*)$/i.exec(l); if (!m) return false; const parts = m[1].split(/[\s,]+/).filter(Boolean); return parts.length > 0 && parts.every((x) => ref.test(x)); };
  if (inner.some((l) => !onlyRefs(l))) return "the crew-studio:depends block in the body holds other text than Depends-on lines naming pull requests; fix it on GitHub first";
  return null;
}
/** The body with only Studio's block replaced (or appended at the end), in the body's own line endings; everything outside
 *  the block is kept byte for byte. Throws blockProblem's reason. */
export function replaceBlock(body: string, block: string): string {
  const b = String(body ?? ""), why = blockProblem(b); if (why) throw new Error(why);
  const eol = b.includes("\r\n") ? "\r\n" : "\n", blk = block.split("\n").join(eol), f = findBlock(b);
  if (f && f !== "malformed") return b.slice(0, f.start) + blk + b.slice(f.end);
  // appended after the body as it is (nothing trimmed), set apart by one blank line: removeBlock takes back exactly that
  return b ? `${b}${eol}${eol}${blk}${eol}` : `${blk}${eol}`;
}
/** The body without Studio's block: the block, its own line ending, and at most the one blank line that set it apart
 *  (the separator Studio adds when it appends the block). Everything else is kept byte for byte, paragraph breaks included. */
export function removeBlock(body: string): string {
  const b = String(body ?? ""), why = blockProblem(b); if (why) throw new Error(why);
  const f = findBlock(b); if (!f || f === "malformed") return b;
  const eol = b.includes("\r\n") ? "\r\n" : "\n";
  let before = b.slice(0, f.start), after = b.slice(f.end);
  const ownLine = (before === "" || before.endsWith(eol)) && (after === "" || after.startsWith(eol));
  if (!ownLine) return before + after; // inside a line: only the block itself goes
  if (after.startsWith(eol)) after = after.slice(eol.length); // the block's own line ending
  if (after === "" && before.endsWith(eol + eol) && before.length > 2 * eol.length) before = before.slice(0, -2 * eol.length); // at the end: the separator replaceBlock appended
  else if (before.endsWith(eol + eol) && (after === "" || after.startsWith(eol))) before = before.slice(0, -eol.length); // one blank-line separator
  else if (before === "" && after.startsWith(eol)) after = after.slice(eol.length);
  return before + after;
}
/** The pull requests Studio's block in a body names (null when the body has no block). */
export function blockDeps(body: string, repo: string): string[] | null {
  const f = findBlock(body); if (!f || f === "malformed") return null;
  const out: string[] = [];
  for (const m of f.text.matchAll(/^depends-on\s*:\s*(.+)$/gim)) for (const id of prMentions(m[1], repo)) if (!out.some((x) => x.toLowerCase() === id.toLowerCase())) out.push(id);
  return out;
}
export const normBlock = (t: string | null) => t == null ? null : t.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();

// ---------- test evidence ----------
export type Verdict = "pass" | "conditional" | "fail" | "code-only" | "unclassified";
const LABEL_LINE = /^(?:verdict|result|results|status|outcome|test result|qa|結論|結果|測試結果|测试结果|结论|结果|測試結論|测试结论|驗收結論|验收结论)\s*[:：]/i;
/** A line that names the report's conclusion: a heading or label "結論 / 测试结论 / Verdict / Conclusion …", or a table row whose first cell is one. */
const CONCLUSION = /^(?:(?:test\s+)?(?:verdict|conclusion|result)|(?:測試|测试|驗收|验收|qa\s*)?(?:結論|结论))(?:\s*[:：|]\s*|\s*$)/i;
/** An HTML report as text lines: block tags end a line, every other tag goes, the common entities are decoded. */
const htmlLines = (t: string) => /<(?:p|div|h[1-6]|li|br|table|tr|td|th|strong|span|html|body)\b/i.test(t)
  ? t.replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/table)\s*\/?>/gi, "\n").replace(/<\/t[dh]>/gi, " | ").replace(/<[^>]{0,400}>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  : t;
const strip = (l: string) => l.replace(/[*_`~>#|]/g, " ").replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
function verdictOf(line: string): Verdict | null {
  const l = line.toLowerCase();
  if (/conditional(?:ly)?(?:\s+pass(?:ed)?)?|pass(?:ed)?\s+with\s+conditions?|有條件通過|有条件通过|條件通過|条件通过/.test(l)) return "conditional";
  if (/code[- ]review only|code[- ]only|只審\s*code|只审\s*code|僅\s*code\s*review|仅\s*code\s*review/.test(l)) return "code-only";
  // a negated pass is never a pass: "not yet" says nothing, the other negations are a fail
  if (/\bnot\s+yet\b|尚未|還沒|还没/.test(l)) return null;
  if (/\b(?:not|never|didn'?t|doesn'?t|don'?t|isn'?t|wasn'?t|aren'?t|weren'?t|won'?t|can'?t|cannot|couldn'?t|did\s+not|does\s+not|do\s+not|is\s+not|was\s+not|failed\s+to)\s+(?:\w+\s+)?pass/.test(l)) return "fail";
  if (/\bfail(?:ed|s|ure|ing)?\b|❌|不通過|未通過|不通过|未通过|沒通過|没通过|沒有通過|没有通过|失敗|失败/.test(l)) return "fail";
  if (/\bpass(?:ed|es)?\b|\blgtm\b|✅|通過|通过/.test(l)) return "pass";
  return null;
}
/**
 * A comment's verdict by rules: a heading, a "Verdict:/Result:/結論:" line, or a short line on its own that names pass,
 * conditional, fail or code review only. Two such lines that disagree, or none, read "unclassified". Commit SHAs named
 * anywhere in the comment are returned (7 to 40 hex characters with at least one letter and one digit).
 */
export function classifyComment(body: string): { verdict: Verdict; shas: string[] } {
  const raw = String(body ?? "").slice(0, 65536), text = htmlLines(raw), found = new Set<Verdict>(), concluded = new Set<Verdict>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]; if (t.length > 500) continue; // a verdict line is short: long lines are never read by a pattern
    // the report's own conclusion ("### 测试结论" then its line, "**测试结论：…**", "| 结论 | … |") outranks every other line
    const st = strip(t), lead = t.replace(/^[\s|*_#>`~]+/, "").replace(/[*_`~]/g, "").trim(); // lead keeps the table's | separators
    if (CONCLUSION.test(lead)) { const rest = lead.replace(CONCLUSION, ""), own = verdictOf(strip(rest)) ?? (strip(rest) ? null : lines[i + 1] && lines[i + 1].length <= 500 ? verdictOf(strip(lines[i + 1])) : null); if (own) concluded.add(own); }
    const heading = /^#{1,6}\s/.test(t), bold = /^\*\*[^*]+\*\*\s*(?:[:：]\s*)?\S*$/.test(t), label = LABEL_LINE.test(st), short = st.length <= 24;
    if (!(heading || bold || label || short)) continue;
    const v = verdictOf(st); if (v) found.add(v);
  }
  if (concluded.size) found.clear(), concluded.forEach((v) => found.add(v));
  const shas = [...new Set([...raw.matchAll(/\b[0-9a-f]{7,40}\b/gi)].map((m) => m[0].toLowerCase()).filter((s) => /[a-f]/.test(s) && /\d/.test(s)))];
  return { verdict: found.size === 1 ? [...found][0] : "unclassified", shas };
}
export type Commit = { sha: string; at: string };
export type Evidence = { verdict: Verdict; source: "comment" | "check" | "label"; by: string; at: string | null; url: string | null; covers: "head" | "older" | "unknown" | "unbound"; since: string | null; shas: string[] };
/**
 * Which commit a comment's verdict covers: the latest pull request commit it names. A comment that names none covers the
 * head only when Studio itself saw that head before the comment was written (`headSeenAt`, from its own refreshes); a
 * commit's date is when it was made, not when it was pushed, so it proves nothing. Otherwise the coverage is unknown.
 */
export function coverage(shas: string[], at: string, commits: Commit[], head: string, headSeenAt: string | null = null): { covers: "head" | "older" | "unknown"; since: string | null } {
  const named = commits.filter((c) => shas.some((s) => c.sha.toLowerCase().startsWith(s)));
  if (named.length) { const tested = named[named.length - 1]; return tested.sha === head ? { covers: "head", since: null } : { covers: "older", since: tested.sha.slice(0, 7) }; }
  if (headSeenAt && Date.parse(headSeenAt) <= Date.parse(at)) return { covers: "head", since: null };
  return { covers: "unknown", since: null };
}
export type EvidenceInput = {
  comments: { login: string; body: string; at: string; url: string }[];
  checks: { name: string; status: string; conclusion: string | null; at: string | null; url: string | null }[];
  labels: string[]; commits: Commit[]; head: string; headSeenAt?: string | null;
};
export type EvidenceSources = { accounts: string[]; checks: string[]; labels: string[] };
/** The latest evidence from the configured sources: a classified comment or a named check run (newest first), else a label. */
export function evidenceOf(src: EvidenceSources, x: EvidenceInput): Evidence | null {
  const acct = new Set(src.accounts.map((a) => a.toLowerCase())), cands: Evidence[] = [];
  const mine = x.comments.filter((c) => acct.has(c.login.toLowerCase())).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const classified = mine.map((c) => ({ c, k: classifyComment(c.body) })), decided = classified.filter((r) => r.k.verdict !== "unclassified");
  const pick = decided.at(-1) ?? classified.at(-1);
  if (pick) { const cov = coverage(pick.k.shas, pick.c.at, x.commits, x.head, x.headSeenAt ?? null); cands.push({ verdict: pick.k.verdict, source: "comment", by: pick.c.login, at: pick.c.at, url: pick.c.url, covers: cov.covers, since: cov.since, shas: pick.k.shas }); }
  const names = new Set(src.checks.map((n) => n.toLowerCase()));
  for (const c of x.checks) if (names.has(c.name.toLowerCase()) && c.status === "completed") {
    const ok = ["success", "neutral"].includes(String(c.conclusion)), skip = ["skipped", "cancelled", "stale"].includes(String(c.conclusion));
    if (!skip) cands.push({ verdict: ok ? "pass" : "fail", source: "check", by: c.name, at: c.at, url: c.url, covers: "head", since: null, shas: [x.head] });
  }
  const best = cands.sort((a, b) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0))[0];
  if (best) return best;
  const lab = x.labels.find((l) => src.labels.some((s) => s.toLowerCase() === l.toLowerCase()));
  return lab ? { verdict: "pass", source: "label", by: lab, at: null, url: null, covers: "unbound", since: null, shas: [] } : null;
}

// ---------- branch rules and approvals ----------
export type Rules = { readable: true; required: number; codeOwners: boolean; lastPush: boolean; dismissStale: boolean; teams: { key: string; label: string }[]; sources: string[];
  /** parts of the rules Studio could not read but worked around: classic protection that needs admin access */
  unread?: { en: string; tw: string }[] }
  | { readable: false; reason: string; tw: string };
/** Merge a base branch's rulesets (GET …/rules/branches/<base>) and classic protection (GET …/branches/<base>/protection).
 *  `unread` names classic protection Studio may not read (it needs admin access): the rules are then the rulesets, and
 *  GitHub's own review decision stands in for what the protection may add (approvalsOf). */
export function mergeRules(rulesets: any[] | null, protection: any | "none" | null, unreadable: { en: string; tw: string } | null, owner = "", unread: { en: string; tw: string } | null = null): Rules {
  if (unreadable) return { readable: false, reason: unreadable.en, tw: unreadable.tw };
  let required = 0, codeOwners = false, lastPush = false, dismissStale = false; const teams: { key: string; label: string }[] = [], sources: string[] = [];
  for (const r of rulesets ?? []) if (r?.type === "pull_request") {
    const p = r.parameters ?? {}; sources.push("ruleset");
    required = Math.max(required, Number(p.required_approving_review_count) || 0); codeOwners ||= !!p.require_code_owner_review;
    lastPush ||= !!p.require_last_push_approval; dismissStale ||= !!p.dismiss_stale_reviews_on_push;
    for (const rr of Array.isArray(p.required_reviewers) ? p.required_reviewers : []) { const rv = rr?.reviewer ?? {};
      if (String(rv.type).toLowerCase() === "team" && (rv.slug || rv.id != null)) { const key = rv.slug ? `slug:${rv.slug}` : `id:${rv.id}`; if (!teams.some((t) => t.key === key)) teams.push({ key, label: rv.slug ? `@${owner ? `${owner}/` : ""}${rv.slug}` : `team ${rv.id}` }); } }
  }
  const pr = protection && protection !== "none" ? protection.required_pull_request_reviews : null;
  if (pr) { sources.push("protection"); required = Math.max(required, Number(pr.required_approving_review_count) || 0); codeOwners ||= !!pr.require_code_owner_reviews; lastPush ||= !!pr.require_last_push_approval; dismissStale ||= !!pr.dismiss_stale_reviews; }
  return { readable: true, required, codeOwners, lastPush, dismissStale, teams, sources, ...(unread ? { unread: [unread] } : {}) };
}
export type Review = { login: string; state: string; commit: string | null; at: string };
export type ReviewView = { login: string; state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" | "COMMENTED"; stale: boolean; at: string; author: boolean };
/** Each reviewer's latest verdict (a later comment does not undo an approval), stale when it was given on another head. */
export function latestReviews(reviews: Review[], head: string, author: string): ReviewView[] {
  const by = new Map<string, ReviewView>();
  for (const r of [...reviews].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const k = r.login.toLowerCase(), st = String(r.state).toUpperCase(), prev = by.get(k);
    if (st === "PENDING") continue;
    if (st === "COMMENTED" && prev && prev.state !== "COMMENTED") continue;
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED", "COMMENTED"].includes(st)) continue;
    by.set(k, { login: r.login, state: st as ReviewView["state"], stale: !!r.commit && r.commit !== head, at: r.at, author: k === author.toLowerCase() });
  }
  return [...by.values()];
}
// CODEOWNERS: the last matching line wins (GitHub's rule); patterns follow gitignore's shape
export const CODEOWNERS_LIMITS = { bytes: 200000, lines: 2000, pattern: 256, patternSegments: 32, path: 1024, pathSegments: 32, steps: 1_000_000 };
/** A shared count of matching steps: one row's code-owner check may take at most CODEOWNERS_LIMITS.steps, then "limit". */
export type StepBudget = { left: number };
/** Whether a CODEOWNERS text is past Studio's limits (then the code owners are unreadable: a rule past them may own a file). */
export function codeownersOverLimit(text: string): string | null {
  const t = String(text ?? "");
  if (t.length > CODEOWNERS_LIMITS.bytes) return `the CODEOWNERS file is over ${CODEOWNERS_LIMITS.bytes} characters`;
  if (t.split(/\r?\n/).length > CODEOWNERS_LIMITS.lines) return `the CODEOWNERS file has over ${CODEOWNERS_LIMITS.lines} lines`;
  return null;
}
export function parseCodeowners(text: string): { pattern: string; owners: string[] }[] {
  return String(text ?? "").split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "").trim()).filter(Boolean)
    .map((l) => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners: owners.filter((o) => /^@[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(o) || /^[^@\s]+@[^@\s]+$/.test(o)) }; });
}
// No regular expression is built from a pattern (a CODEOWNERS line is text others write): a segment matcher with a
// two-pointer wildcard walk, and `**` segments matched over path segments with a memo, so the work is bounded by
// (pattern segments × path segments × segment length). A pattern over 256 characters or 32 segments, a path over
// 1024 characters or 32 segments, or a check that runs past its step budget, answers "limit": the caller treats the
// owners as unreadable, never as no match.
class OverSteps extends Error {}
const segMatch = (p: string, s: string, b?: StepBudget) => {
  let i = 0, j = 0, star = -1, mark = 0;
  while (j < s.length) {
    if (b && --b.left < 0) throw new OverSteps();
    if (i < p.length && (p[i] === "?" || p[i] === s[j])) { i++; j++; }
    else if (i < p.length && p[i] === "*") { star = i++; mark = j; }
    else if (star >= 0) { i = star + 1; j = ++mark; }
    else return false;
  }
  while (i < p.length && p[i] === "*") i++;
  return i === p.length;
};
export function globMatch(pattern: string, path: string, budget?: StepBudget): boolean | "limit" {
  const L = CODEOWNERS_LIMITS; if (pattern.length > L.pattern || path.length > L.path) return "limit";
  let pat = pattern, anchored = pat.startsWith("/"); if (anchored) pat = pat.slice(1);
  const dirOnly = pat.endsWith("/"); if (dirOnly) pat = pat.slice(0, -1);
  if (!pat) return true;
  if (pat.includes("/")) anchored = true;
  const ps = pat.split("/").map((x) => x === "**" ? x : x.replace(/\*+/g, "*")), ss = path.split("/");
  if (!anchored) ps.unshift("**");
  if (ps.length > L.patternSegments || ss.length > L.pathSegments) return "limit";
  const memo = new Map<number, boolean>();
  const go = (pi: number, si: number): boolean => {
    const k = pi * 256 + si; const m = memo.get(k); if (m !== undefined) return m;
    if (budget && --budget.left < 0) throw new OverSteps();
    let r: boolean;
    if (pi === ps.length) r = dirOnly ? si < ss.length : si <= ss.length; // a pattern matching a directory owns what is in it
    else if (ps[pi] === "**") r = go(pi + 1, si) || (si < ss.length && go(pi, si + 1));
    else r = si < ss.length && segMatch(ps[pi], ss[si], budget) && go(pi + 1, si + 1);
    memo.set(k, r); return r;
  };
  try { return go(0, 0); } catch (e) { if (e instanceof OverSteps) return "limit"; throw e; }
}
/** The owners of a path (the last matching line wins); "limit" when a line or the path is past the limits, since that
 *  line could be the one that owns it. */
export function ownersOf(path: string, rules: { pattern: string; owners: string[] }[], budget?: StepBudget): string[] | "limit" {
  let out: string[] = [];
  for (const r of rules) { const m = globMatch(r.pattern, path, budget); if (m === "limit") return "limit"; if (m) out = r.owners; }
  return out;
}
export type Missing = { kind: "count"; n: number } | { kind: "owner"; who: string[] } | { kind: "team"; who: string } | { kind: "unreadable"; reason: string; tw: string }
  /** GitHub's merge box says a review is still required, for a rule Studio could not read; `who` are the pending review requests */
  | { kind: "github"; who: string[] };
/** What GitHub itself says about a pull request's merge (GraphQL reviewDecision, mergeStateStatus, review requests). */
export type GitHubMerge = { reviewDecision: string | null; mergeState: string | null; requested: string[] };
export type Approvals = { readable: boolean; required: number; counted: number; codeOwners: boolean; lastPush: boolean; dismissStale: boolean; missing: Missing[]; sources: string[];
  /** rules Studio could not read, and GitHub's own merge state shown beside them */
  unread?: { en: string; tw: string }[]; github?: GitHubMerge | null;
  /** classic protection unread, and GitHub blocks the merge for a reason the readable rules do not show (a required
   *  check, a rule Studio cannot see): not a missing approval, and never ready */
  blocked?: boolean;
  /** each group the rules ask an approval from (a required team, a set of code owners): met or not, and by whom */
  groups?: { who: string; kind: "team" | "owner"; ok: boolean; by: string[];
    /** a code-owner group: the changed files it owns (at most 20) */ files?: string[];
    /** a code-owner group no one but the author can approve (the author's own approval never counts): GitHub cannot be
     *  satisfied by the people here; another owner, or an admin, has to act */ authorOnly?: boolean }[];
  /** with "approval after the last push": the logins treated as the pusher (inferred: GitHub does not expose who pushed) */
  inferredPusher?: string[] };
/**
 * What the base branch's rules still miss. The author's own approval never counts; an approval given on another head is
 * stale and counts only when neither the rules dismiss stale approvals nor ask for an approval after the last push (then
 * the inferred pusher's own approval does not count either). Code owners: every changed file's owners need one approval from
 * an owner (a user, or a member of an owner team). Required teams: one approval from a member each.
 */
export function approvalsOf(rules: Rules, reviews: ReviewView[], o: { files: string[]; codeowners: { pattern: string; owners: string[] }[] | null; teamMembers: Map<string, string[] | null>;
  /** the pull request's author, and the head commit's author and committer logins (null when the head commit could not be read) */
  author?: string; headCommit?: { author: string | null; committer: string | null } | null;
  /** owners already found for a path under the same CODEOWNERS (shared by the rows of one repository and base) */
  ownersCache?: Map<string, string[] | "limit">;
  /** why the code owners cannot be checked: CODEOWNERS or the changed files could not be read (not "no owner applies") */
  ownersUnreadable?: { en: string; tw: string } | null;
  /** GitHub's own merge state: with classic protection unread, a review decision of REVIEW_REQUIRED that the readable rules
   *  do not explain is a missing review (who: the pending review requests) */
  github?: GitHubMerge | null }): Approvals {
  if (!rules.readable) return { readable: false, required: 0, counted: 0, codeOwners: false, lastPush: false, dismissStale: false, missing: [{ kind: "unreadable", reason: rules.reason, tw: rules.tw }], sources: [] };
  // "approval after the last push": an approval counts when it was given on the current head, by someone other than the
  // pusher. GitHub does not say who pushed, so the pusher is inferred: the pull request's author and the head commit's
  // author and committer. Without the head commit the rule cannot be applied: unreadable.
  if (rules.lastPush && !o.headCommit) return { readable: false, required: rules.required, counted: 0, codeOwners: rules.codeOwners, lastPush: true, dismissStale: rules.dismissStale, missing: [{ kind: "unreadable", reason: "the branch rules ask for an approval after the last push, and the head commit could not be read", tw: "分支規則要求最後一次 push 之後的 approve，但讀不到 head commit" }], sources: rules.sources };
  const pusher = rules.lastPush ? [...new Set([o.author, o.headCommit?.author, o.headCommit?.committer].filter((x): x is string => !!x).map((x) => x.toLowerCase()))] : [];
  if (rules.codeOwners && o.ownersUnreadable) return { readable: false, required: rules.required, counted: 0, codeOwners: true, lastPush: rules.lastPush, dismissStale: rules.dismissStale, missing: [{ kind: "unreadable", reason: o.ownersUnreadable.en, tw: o.ownersUnreadable.tw }], sources: rules.sources };
  const valid = reviews.filter((r) => r.state === "APPROVED" && !r.author && (!r.stale || (!rules.dismissStale && !rules.lastPush)) && !pusher.includes(r.login.toLowerCase()));
  const approvers = new Set(valid.map((r) => r.login.toLowerCase())), missing: Missing[] = [], groups: NonNullable<Approvals["groups"]> = [];
  // "approval after the last push" asks for one approval on the head by someone other than the pusher, even when the
  // rules ask for no approval count
  const needed = Math.max(rules.required, rules.lastPush ? 1 : 0);
  if (valid.length < needed) missing.push({ kind: "count", n: needed - valid.length });
  const memberOf = (team: string) => (o.teamMembers.get(team.toLowerCase()) ?? []).map((m) => m.toLowerCase());
  if (rules.codeOwners && o.codeowners) {
    const sets = new Map<string, { ow: string[]; files: string[] }>();
    const budget: StepBudget = { left: CODEOWNERS_LIMITS.steps };
    for (const f of o.files) { let ow = o.ownersCache?.get(f); if (ow === undefined) { ow = ownersOf(f, o.codeowners, budget); if (ow !== "limit") o.ownersCache?.set(f, ow); }
      if (ow === "limit") return { readable: false, required: rules.required, counted: valid.length, codeOwners: true, lastPush: rules.lastPush, dismissStale: rules.dismissStale, sources: rules.sources,
        missing: [{ kind: "unreadable", reason: "a CODEOWNERS line or a changed file's path is past Studio's limits, so the code owners cannot be checked", tw: "CODEOWNERS 的某一行或某個改動檔案的路徑超過 Studio 的上限，無法檢查 code owner" }] };
      if (ow.length) { const k = ow.map((x) => x.toLowerCase()).sort().join(" "), cur = sets.get(k) ?? { ow, files: [] }; if (cur.files.length < 20) cur.files.push(f); sets.set(k, cur); } }
    // a team owner whose members could not be read: Studio cannot tell who may approve, so it stops and asks
    const unreadTeam = [...sets.values()].flatMap((x) => x.ow).find((x) => x.includes("/") && o.teamMembers.get(x.replace(/^@/, "").toLowerCase()) == null);
    if (unreadTeam) return { readable: false, required: rules.required, counted: valid.length, codeOwners: true, lastPush: rules.lastPush, dismissStale: rules.dismissStale, sources: rules.sources,
      missing: [{ kind: "unreadable", reason: `the members of the code-owner team ${unreadTeam} could not be read`, tw: `讀不到 code owner team ${unreadTeam} 的成員` }] };
    for (const { ow, files } of sets.values()) {
      // who can approve this group: users other than the author, and members of the owner teams (an empty team counts no one)
      const author = String(o.author ?? "").toLowerCase(), can = [...ow.filter((x) => !x.includes("/")).map((x) => x.replace(/^@/, "").toLowerCase()), ...ow.filter((x) => x.includes("/")).flatMap((x) => memberOf(x.replace(/^@/, "")))].filter((x) => x && x !== author);
      const by = valid.filter((r) => ow.some((x) => x.includes("/") ? memberOf(x.replace(/^@/, "")).includes(r.login.toLowerCase()) : x.replace(/^@/, "").toLowerCase() === r.login.toLowerCase())).map((r) => r.login);
      groups.push({ who: ow.join(" | "), kind: "owner", ok: by.length > 0, by, files, ...(!by.length && !can.length ? { authorOnly: true } : {}) }); if (!by.length) missing.push({ kind: "owner", who: ow }); }
  }
  for (const t of rules.teams) { const by = valid.filter((r) => memberOf(t.key).includes(r.login.toLowerCase())).map((r) => r.login);
    groups.push({ who: t.label, kind: "team", ok: by.length > 0, by }); if (!by.length) missing.push({ kind: "team", who: t.label }); }
  // Classic protection unread: GitHub's merge box stands in for it. Without the merge box (its read failed) the rules
  // are unreadable, never "nothing missing"; a review decision of REVIEW_REQUIRED, or a merge GitHub blocks, that the
  // readable rules do not explain is still missing.
  if (rules.unread?.length) {
    if (!o.github?.mergeState) return { readable: false, required: rules.required, counted: valid.length, codeOwners: rules.codeOwners, lastPush: rules.lastPush, dismissStale: rules.dismissStale, sources: rules.sources, unread: rules.unread, github: o.github ?? null, groups,
      missing: [{ kind: "unreadable", reason: `${rules.unread[0].en}, and GitHub's merge box could not be read`, tw: `${rules.unread[0].tw}，也讀不到 GitHub 的 merge 狀態` }] };
    if (!missing.length && o.github.reviewDecision === "REVIEW_REQUIRED") missing.push({ kind: "github", who: o.github.requested.slice(0, 10) });
  }
  // UNKNOWN: GitHub is still computing the merge state (just after a push); with the protection unread that is not ready either
  const blocked = !!rules.unread?.length && !missing.length && (o.github?.mergeState === "BLOCKED" || o.github?.mergeState === "UNKNOWN");
  return { readable: true, required: rules.required, counted: valid.length, codeOwners: rules.codeOwners, lastPush: rules.lastPush, dismissStale: rules.dismissStale, missing, sources: rules.sources, groups,
    ...(rules.lastPush ? { inferredPusher: pusher } : {}), ...(rules.unread?.length ? { unread: rules.unread, github: o.github ?? null } : {}), ...(blocked ? { blocked } : {}) };
}
export const missingWho = (m: Missing[]): string[] => m.flatMap((x) => x.kind === "count" ? [`${x.n} more approval${x.n === 1 ? "" : "s"}`] : x.kind === "owner" ? [x.who.join(" | ")] : x.kind === "team" ? [x.who] : x.kind === "github" ? [x.who.length ? x.who.join(" | ") : "a review GitHub still requires"] : []);

// ---------- the next step ----------
export type StepKind = "hold" | "fix" | "review" | "dependency" | "deploy" | "nudge" | "test" | "approve" | "merge";
export const RULES: { id: string; kind: StepKind; en: string; tw: string }[] = [
  { id: "draft", kind: "hold", en: "draft → on hold", tw: "draft → 暫緩" },
  { id: "unread", kind: "hold", en: "Studio could not read every review or comment (a read failed, or there are more than it reads) → on hold (see GitHub)", tw: "Studio 沒讀到全部的 review 或留言（讀取失敗，或超過它讀的數量）→ 暫緩（看 GitHub）" },
  { id: "evidence-asked", kind: "test", en: "a reviewer asked for evidence, not a code change (their comment, quoted) → test (QA)", tw: "reviewer 要的是外部證據，不是改代碼（引用原句）→ 測試（QA）" },
  { id: "re-review", kind: "nudge", en: "the evidence covers the current head while a reviewer's verdict is on an older head → ask them to look again", tw: "證據已覆蓋目前 head，reviewer 的意見還停在舊 head → 請 reviewer 重驗" },
  { id: "changes", kind: "fix", en: "a reviewer asked for changes → fix (the author)", tw: "有人要求修改 → 修正（作者）" },
  { id: "required", kind: "review", en: "a required reviewer has not reviewed → wait for them", tw: "必要 reviewer 還沒 review → 等他" },
  { id: "dependency", kind: "dependency", en: "a dependency is not merged → wait for it", tw: "依賴還沒合併 → 等依賴" },
  { id: "environment", kind: "deploy", en: "the head runs in no pre-production environment → deploy for testing", tw: "head 沒在任何測試環境 → 部署去測" },
  { id: "failed", kind: "fix", en: "the test evidence says fail → fix (the author)", tw: "測試證據是不通過 → 修正（作者）" },
  { id: "evidence", kind: "test", en: "(an evidence source is set) no evidence, unclassified, code review only, evidence for an older head, or evidence that names no commit → test", tw: "（已設定證據來源）沒有證據、無法分類、只審 code、證據不是這個 head、或證據沒指明 commit → 測試" },
  { id: "approvals", kind: "approve", en: "approvals missing (or the rules cannot be read) → approve", tw: "approve 不夠（或讀不到規則）→ approve" },
  { id: "blocked", kind: "hold", en: "the branch protection could not be read and GitHub blocks the merge for a reason the readable rules do not show → on hold (see the merge box on GitHub)", tw: "讀不到分支保護，GitHub 又因為讀得到的規則看不出的原因擋住 merge → 暫緩（看 GitHub 的 merge 區塊）" },
  { id: "ready", kind: "merge", en: "everything above is satisfied → ready to merge (you)", tw: "以上都滿足 → 可合併（你）" },
];
export type StepInput = {
  draft: boolean; author: string; reviews: ReviewView[]; requiredReviewers: string[];
  deps: { id: string; done: boolean }[]; envs: { name: string; on: boolean; production: boolean }[];
  evidence: Evidence | null; evidenceSources: EvidenceSources; approvals: Approvals;
  /** what Studio could not read in full (a read failed, or past its page cap): "reviews", "comments" */
  incomplete?: string[];
  /** the follow-through's reading of the reviewers (src/pr-watch-follow.ts shepherd): a change request that asked for
   *  evidence, or evidence that now covers the head, is not a fix */
  follow?: { branch: string; who: string[]; quote?: string | null } | null;
};
export type Step = { rule: string; kind: StepKind; who: string[]; reason?: string; since?: string | null; matched: boolean[] };
/** The first matching rule, top to bottom (RULES). `matched` says which rules match at all, for the detail view. */
export function nextStep(p: StepInput): Step {
  const reviewed = new Set(p.reviews.map((r) => r.login.toLowerCase())); // any review, a comment included
  const pendingRequired = p.requiredReviewers.filter((r) => r.toLowerCase() !== p.author.toLowerCase() && !reviewed.has(r.toLowerCase()));
  const changes = p.reviews.filter((r) => r.state === "CHANGES_REQUESTED");
  const open = p.deps.filter((d) => !d.done);
  const pre = p.envs.filter((e) => !e.production);
  const ev = p.evidence;
  const noSource = !p.evidenceSources.accounts.length && !p.evidenceSources.checks.length && !p.evidenceSources.labels.length;
  const evWho = p.evidenceSources.accounts.length || p.evidenceSources.checks.length || p.evidenceSources.labels.length ? [...p.evidenceSources.accounts, ...p.evidenceSources.checks, ...p.evidenceSources.labels] : ["(no evidence source set)"];
  const tests: [boolean, () => Omit<Step, "matched">][] = [
    [p.draft, () => ({ rule: "draft", kind: "hold", who: [p.author] })],
    // without every review and comment, a change request or a later failing verdict may be among the unread ones
    [!!p.incomplete?.some((x) => x === "reviews" || x === "comments"), () => ({ rule: "unread", kind: "hold", who: ["(see GitHub)"], reason: p.incomplete!.filter((x) => x === "reviews" || x === "comments").join(", ") })],
    [p.follow?.branch === "needs-evidence" && changes.length > 0, () => ({ rule: "evidence-asked", kind: "test", who: p.follow!.who, reason: p.follow!.quote ?? undefined })],
    [p.follow?.branch === "evidence-covers-head", () => ({ rule: "re-review", kind: "nudge", who: p.follow!.who })],
    [changes.length > 0, () => ({ rule: "changes", kind: "fix", who: [p.author], reason: changes.map((c) => c.login).join(", ") })],
    [pendingRequired.length > 0, () => ({ rule: "required", kind: "review", who: pendingRequired })],
    [open.length > 0, () => ({ rule: "dependency", kind: "dependency", who: open.map((d) => d.id) })],
    [pre.length > 0 && !pre.some((e) => e.on), () => ({ rule: "environment", kind: "deploy", who: [p.author] })],
    [ev?.verdict === "fail", () => ({ rule: "failed", kind: "fix", who: [p.author], reason: ev?.by })],
    // no evidence source set: the rule does not apply (as with no environment); the evidence column offers Set up
    [!noSource && (!ev || ev.verdict === "unclassified" || ev.verdict === "code-only" || ev.covers === "older" || ev.covers === "unknown"), () => ({ rule: "evidence", kind: "test", who: evWho, since: ev && ev.covers === "older" && ev.verdict !== "fail" ? ev.since : null, reason: ev && ev.covers === "unknown" && ev.verdict !== "unclassified" && ev.verdict !== "code-only" ? "unknown-commit" : ev?.verdict })],
    [p.approvals.missing.length > 0, () => ({ rule: "approvals", kind: "approve", who: p.approvals.readable ? missingWho(p.approvals.missing) : ["(rules unreadable)"] })],
    [!!p.approvals.blocked, () => ({ rule: "blocked", kind: "hold", who: ["(GitHub blocks the merge)"] })],
    [true, () => ({ rule: "ready", kind: "merge", who: ["captain"] })],
  ];
  const matched = tests.map(([t]) => !!t), i = matched.indexOf(true);
  return { ...tests[i][1](), matched };
}

// ---------- environments ----------
/** "deployed" is never a setting: Studio uses it for a repository's own GitHub environments when none are set (the
 *  environment's latest successful deployment contains the head). */
export type EnvDetect = { kind: "deployed"; environment: string } | { kind: "deployment"; environment: string } | { kind: "check"; name: string } | { kind: "branch"; branch: string; environment?: string } | { kind: "file"; repository: string; path: string; template: string; ref?: string };
export type EnvSetting = { name: string; production: boolean; repos: string[]; detect: EnvDetect };
export const envApplies = (e: EnvSetting, repo: string) => !e.repos.length || e.repos.some((r) => sameRepo(r, repo));
/** A tag template: literal text around exactly one `{tag}`, e.g. `image: registry/app:{tag}`. No regular expression is
 *  taken from the settings; Studio matches the literal prefix, then a tag of [0-9A-Za-z._-]{1,128}, then the literal suffix. */
export function templateProblem(t: string): string | null {
  const s = String(t ?? "");
  if (!s || s.length > 200) return "write a line with {tag} where the tag is, e.g. image: registry/app:{tag}";
  if (s.split("{tag}").length !== 2) return "the template needs exactly one {tag}";
  if (/[\r\n]/.test(s)) return "the template is one line";
  if (!s.split("{tag}")[0].trim()) return "write the text that comes before {tag} on that line, e.g. image: registry/app:{tag}";
  return null;
}
const TAG_CHAR = /^[0-9A-Za-z._-]$/;
const isTag = (t: string) => t.length >= 1 && t.length <= 128 && [...t].every((c) => TAG_CHAR.test(c));
/** The commit a tag ends in: its trailing 7 to 40 hex characters, not all digits (a date or a build number is no commit). */
export function commitOfTag(tag: string): string | null {
  const m = /[0-9a-f]{7,40}$/i.exec(tag); if (!m || /^\d+$/.test(m[0])) return null;
  return m[0].toLowerCase();
}
/**
 * The commit an image tag names: the first place on a line where the template's text before {tag} is followed by a tag
 * of [0-9A-Za-z._-]{1,128} and then the text after {tag} (found first, so a suffix made of tag characters still
 * matches). With nothing after {tag}, the tag ends at the end of the line or the first other character, and a longer
 * run is no tag. Each line is scanned forward once per occurrence of the prefix: linear in the line's length.
 */
export function tagCommit(text: string, template: string): string | null { const t = tagOf(text, template); return t ? commitOfTag(t) : null; }
/** The tag itself (as tagCommit finds it), or null: what a release brief replaces on that line. */
export function tagOf(text: string, template: string): string | null {
  if (templateProblem(template)) return null;
  const [pre, post] = template.split("{tag}");
  for (const line of String(text ?? "").slice(0, 200000).split(/\r?\n/, 5000)) {
    if (line.length > 500) continue;
    for (let from = 0; from < line.length;) {
      const at = line.indexOf(pre, from); if (at < 0 || at >= line.length) break;
      const i = at + pre.length; let j: number;
      if (post) { j = line.indexOf(post, i); if (j < 0) break; }
      else { j = i; while (j < line.length && TAG_CHAR.test(line[j])) j++; }
      const tag = line.slice(i, j);
      if (isTag(tag)) return tag;
      from = at + 1;
    }
  }
  return null;
}

// ---------- merged pull requests, followed until production ----------
/** A merged pull request stays on the list this long after it reached every production environment. */
export const LIVE_KEEP_MS = 14 * 86400_000;
/** How far back a watched repository's merged pull requests are picked up (a tracked one stays until production). */
export const MERGED_WINDOW_MS = 30 * 86400_000;
export type ShipEnv = { name: string; on: boolean | null; production: boolean };
/**
 * Where a merged pull request is on its way to production, from its environments (in the settings' order), each on when
 * its commit contains the merge commit. Live: every production environment has it. Otherwise it waits on the first
 * environment after the furthest one that has it (the first environment when none has it). No production environment
 * set: it can never be live, and the row says so.
 */
export function shipState(envs: ShipEnv[]): { live: boolean; waits: string | null; noProduction: boolean } {
  const prod = envs.filter((e) => e.production);
  if (!prod.length) return { live: false, waits: null, noProduction: true };
  if (prod.every((e) => e.on === true)) return { live: true, waits: null, noProduction: false };
  const furthest = envs.map((e) => e.on === true).lastIndexOf(true);
  const next = envs.slice(furthest + 1).find((e) => e.on !== true) ?? envs.find((e) => e.on !== true)!;
  return { live: false, waits: next.name, noProduction: false };
}

// ---------- order and dependencies ----------
/** A dependency proposed only where the merge order is forced: a Depends-on line, or a branch stacked on another's head. */
export type Signal = { pr: string; on: string; kind: "depends-on" | "stacked"; why: string };
/** An ordering hint: places one before another in the proposed order, never a dependency (it does not hold a row back). */
export type Hint = { first: string; then: string; kind: "files" | "issue" | "mentions"; why: string };
export type PrFacts = { id: string; repo: string; number: number; body: string; base: string; headRef: string; createdAt: string; files: string[]; issues: string[] };
/** The proposal's signals: Depends-on lines, a body naming another watched pull request, a pull request based on another's
 *  branch (stacked) → dependencies; files both change and an issue both link → which goes first (older first). */
export function signals(prs: PrFacts[]): { deps: Signal[]; hints: Hint[] } {
  const ids = new Map(prs.map((p) => [p.id.toLowerCase(), p.id])), deps: Signal[] = [], hints: Hint[] = [];
  const add = (s: Signal) => { if (s.pr.toLowerCase() !== s.on.toLowerCase() && !deps.some((d) => d.pr === s.pr && d.on === s.on)) deps.push(s); };
  for (const p of prs) {
    for (const id of dependsOnLines(p.body, p.repo)) { const on = ids.get(id.toLowerCase()) ?? id; add({ pr: p.id, on, kind: "depends-on", why: `its body says Depends-on: ${on}` }); }
    for (const q of prs) if (q !== p && sameRepo(q.repo, p.repo) && p.base === q.headRef && p.base) add({ pr: p.id, on: q.id, kind: "stacked", why: `it is based on ${q.id}'s branch ${q.headRef}` });
    // a body that only names another pull request (context, "see also", a follow-up) orders it, never makes it a dependency
    for (const id of prMentions(stripBlock(p.body), p.repo)) { const on = ids.get(id.toLowerCase()); if (on && on !== p.id && !deps.some((d) => d.pr === p.id && d.on === on) && !hints.some((h) => h.first === on && h.then === p.id)) hints.push({ first: on, then: p.id, kind: "mentions", why: `its body names ${on}` }); }
  }
  for (let i = 0; i < prs.length; i++) for (let j = i + 1; j < prs.length; j++) {
    const [a, b] = [prs[i], prs[j]].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || x.id.localeCompare(y.id));
    if (sameRepo(a.repo, b.repo)) { const both = a.files.filter((f) => b.files.includes(f)); if (both.length) hints.push({ first: a.id, then: b.id, kind: "files", why: `both change ${both.slice(0, 2).join(", ")}${both.length > 2 ? ` (+${both.length - 2})` : ""}; the older first` }); }
    const iss = a.issues.filter((x) => b.issues.some((y) => y.toLowerCase() === x.toLowerCase())); if (iss.length) hints.push({ first: a.id, then: b.id, kind: "issue", why: `both link ${iss[0]}; the older first` });
  }
  return { deps, hints };
}
/** An order where every dependency comes first, then hints, then age; each item with the reasons that placed it. */
export function proposeOrder(prs: PrFacts[], deps: { pr: string; on: string }[], hints: Hint[]): { id: string; why: string[] }[] {
  const ids = prs.map((p) => p.id), age = new Map(prs.map((p) => [p.id, Date.parse(p.createdAt) || 0]));
  const before = new Map<string, Set<string>>(ids.map((i) => [i, new Set()])), why = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const d of deps) if (before.has(d.pr) && before.has(d.on)) { before.get(d.pr)!.add(d.on); why.get(d.pr)!.push(`after ${d.on} (depends on it)`); }
  for (const h of hints) if (before.has(h.then) && before.has(h.first) && !before.get(h.first)!.has(h.then)) { before.get(h.then)!.add(h.first); why.get(h.then)!.push(`after ${h.first}: ${h.why}`); }
  const out: string[] = [], left = new Set(ids);
  while (left.size) {
    const ready = [...left].filter((i) => [...before.get(i)!].every((b) => !left.has(b)));
    const pool = ready.length ? ready : [...left]; // a cycle: break it by age
    pool.sort((a, b) => age.get(a)! - age.get(b)! || a.localeCompare(b));
    out.push(pool[0]); left.delete(pool[0]);
  }
  return out.map((id) => ({ id, why: why.get(id)!.length ? why.get(id)! : ["opened earlier than the ones after it"] }));
}

/** Each rule as one plain sentence: what is true, and what follows from it (the card's record, a closed card's note). */
const SENTENCES: Record<string, { en: string; tw: string }> = {
  draft: { en: "It is a draft, so it is on hold.", tw: "這是 draft，所以暫緩。" },
  unread: { en: "Studio could not read every review or comment, so it is on hold (see GitHub).", tw: "Studio 沒讀到全部的 review 或留言，所以暫緩（看 GitHub）。" },
  "evidence-asked": { en: "A reviewer asked for evidence, not a code change, so it waits for the QA test.", tw: "reviewer 要的是外部證據，不是改代碼，所以等 QA 實測。" },
  "re-review": { en: "The evidence covers the current head while a reviewer's verdict is older, so the reviewers are asked to look again.", tw: "證據已覆蓋目前 head，reviewer 的意見還停在舊的，所以請 reviewer 重驗。" },
  changes: { en: "A reviewer asked for changes, so the author fixes them.", tw: "有人要求修改，所以由作者修正。" },
  required: { en: "A required reviewer has not reviewed yet, so it waits for them.", tw: "必要 reviewer 還沒 review，所以等他。" },
  dependency: { en: "A pull request it depends on is not merged yet, so it waits for it.", tw: "依賴的 PR 還沒合併，所以等它。" },
  environment: { en: "The head runs in no pre-production environment, so it waits to be deployed for testing.", tw: "head 沒在任何測試環境，所以等部署去測。" },
  failed: { en: "The test evidence says fail, so the author fixes it.", tw: "測試證據是不通過，所以由作者修正。" },
  evidence: { en: "There is no test evidence for the current head, so it waits for a test.", tw: "目前 head 還沒有測試證據，所以等測試。" },
  approvals: { en: "Approvals are missing (or the rules cannot be read), so it waits for them.", tw: "approve 不夠（或讀不到規則），所以等 approve。" },
  blocked: { en: "GitHub blocks the merge for a reason the readable rules do not show, so it is on hold.", tw: "GitHub 因為讀得到的規則看不出的原因擋住 merge，所以暫緩。" },
  ready: { en: "Everything is satisfied, so it is ready to merge.", tw: "條件都滿足，所以可以合併。" },
};
export function ruleSentence(rule: { id?: string; en: string; tw: string }): { en: string; tw: string } {
  return (rule.id && SENTENCES[rule.id]) || { en: rule.en.replace(/\s*→\s*/g, ": "), tw: rule.tw.replace(/\s*→\s*/g, "：") };
}
