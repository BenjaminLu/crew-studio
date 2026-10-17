// One curated commit per Task (retro 2026-10-17, finding 19). A Task's rounds commit on its own branch and that history
// stays in the Task's ledger; what lands on the base is one commit whose subject says what changed (Conventional style,
// within the length limit, never cut mid-word, no "(round N)") and whose body is the spec's what and why plus each done
// line with the checks that proved it, never the worker's raw report. A repository's CONTRIBUTING commit rules win.
import { git } from "../git";

export type CommitConvention = { conventional: boolean; max: number; source: string | null };
export type DoneProof = { text: string; proofs: { check: string; verdict: string }[] };
export type TaskCommitInput = { run: string; head: string; type?: string | null; title: string; what?: string | null; why?: string[]; done: DoneProof[] };

const TYPES = ["feat", "fix", "docs", "test", "refactor", "chore", "perf", "build", "ci", "style", "revert"];
const CONTRIBUTING = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "CONTRIBUTING", "contributing.md"];
const DEFAULT_MAX = 72;

/** The repository's commit rules at a commit: its CONTRIBUTING's commit section (or the whole file when it has none). */
export function commitConvention(repo: string, at: string): CommitConvention {
  for (const path of CONTRIBUTING) {
    const r = git(repo, ["show", `${at}:${path}`]); if (!r.ok || !r.out.trim()) continue;
    const text = r.out.slice(0, 200_000); const section = commitSection(text);
    const rules = section ?? text;
    const conventional = /conventional\s+commits?/i.test(rules) || /`(?:feat|fix)(?:\([^)]*\))?:/.test(rules) || (!section && !/\bcommit/i.test(text));
    const m = /\b(under|fewer than|less than|below|at most|no more than|within|up to|max(?:imum)?(?: of)?|≤|<=?)\s*(\d{2,3})\s*(?:characters|chars?)\b/i.exec(rules);
    let max = DEFAULT_MAX; if (m) { const n = Number(m[2]); max = /^(under|fewer than|less than|below|<)$/i.test(m[1]) ? n - 1 : n; }
    return { conventional, max: Math.max(30, Math.min(100, max)), source: path };
  }
  return { conventional: true, max: DEFAULT_MAX, source: null };
}
function commitSection(text: string): string | null {
  const lines = text.split("\n"); const start = lines.findIndex((l) => /^#{1,6}\s.*\bcommit/i.test(l)); if (start < 0) return null;
  const level = /^#+/.exec(lines[start])![0].length; const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** never on GitHub or in history: a claude.ai link, a session trailer */
const clean = (t: string) => String(t ?? "").replace(/\r/g, "").split("\n").filter((l) => !/^\s*Claude-Session:/i.test(l))
  .join("\n").replace(/https?:\/\/(?:[\w-]+\.)*claude\.ai\/\S*/gi, "").replace(/[ \t]+$/gm, "").trim();
const oneLine = (t: string) => clean(t).replace(/\s+/g, " ").trim();
const TRAILING = /\s+(?:and|or|the|a|an|to|of|for|in|on|with|by|from|at|as|into|that|so|but)$/i;

/** the subject: type prefix (Conventional), the change in the imperative, at most `max` characters, cut between words */
export function commitSubject(type: string | null | undefined, title: string, conv: CommitConvention, fallback: string): string {
  const t = TYPES.includes(String(type ?? "").toLowerCase()) ? String(type).toLowerCase() : "feat";
  let s = oneLine(title).replace(/^\w+(\([^)]*\))?!?:\s*/, "").replace(/\s*\((?:round|visit)\s*\d+\)\s*$/i, "").replace(/[.;:,!\s]+$/, "");
  if (!s) s = fallback;
  const prefix = conv.conventional ? `${t}: ` : "";
  s = conv.conventional ? s.replace(/^./, (c) => c.toLowerCase()) : s.replace(/^./, (c) => c.toUpperCase());
  const room = conv.max - prefix.length;
  if (s.length > room) {
    const words = s.split(" "); let out = "";
    for (const w of words) { const next = out ? `${out} ${w}` : w; if (next.length > room) break; out = next; }
    while (TRAILING.test(out)) out = out.replace(TRAILING, "");
    s = out.replace(/[.;:,!\s]+$/, "") || (conv.conventional ? fallback.replace(/^./, (c) => c.toLowerCase()) : fallback);
  }
  return prefix + s;
}

/** the whole message: the subject, then what and why, then each done line with its proof, then where the rounds are */
export function taskCommitMessage(i: TaskCommitInput, conv: CommitConvention): { subject: string; body: string; message: string } {
  const subject = commitSubject(i.type, i.title, conv, `Task ${i.run}`);
  const parts: string[] = [];
  const what = clean(i.what ?? ""); if (what) parts.push(what);
  const why = (i.why ?? []).map(oneLine).filter(Boolean); if (why.length) parts.push(["Why:", ...why.map((w) => `- ${w}`)].join("\n"));
  const done = i.done.map((d) => ({ text: oneLine(d.text), proofs: d.proofs.filter((p) => p.check) })).filter((d) => d.text);
  if (done.length) parts.push(["Done:", ...done.map((d) => `- ${d.text}${d.proofs.length ? ` (proved by ${d.proofs.map((p) => `${p.check}: ${p.verdict}`).join(", ")})` : " (no check proved it)"}`)].join("\n"));
  parts.push(`Crew Studio Task ${i.run}, reviewed head ${i.head.slice(0, 12)}. Its rounds stay on the Task branch and in its ledger.`);
  const body = parts.join("\n\n").slice(0, 20_000);
  return { subject, body, message: `${subject}\n\n${body}\n` };
}
