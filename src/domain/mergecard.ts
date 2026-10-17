// The intent-aligned merge card (unit intent-merge-card): the structured detail the
// captain reads before a merge, built from the run's own records.
//   intent      the captain's sentence, split into lines the captain ticks as met
//   why / how   the spec's reasons and the worker's report
//   done        each done line with its proof: the checks that proved it, their ledger
//               entries (seq, verdict, head), the evidence files, the red-on-base test
//   walk        the key hunks of the diff, each mapped to the intent lines and done lines
//               it serves (a test block to the done line whose calls it makes; a source
//               hunk to the done lines that call what it changes; a doc hunk to intents)
//   door, review, gates, cost, before/after
//   design      the designer round (src/domain/code-design.ts): not applicable and why, or its verdicts, the last
//               verdict's findings and how many captures it saw, with designer-compare's warnings
// The coordinator agent writes the zh-TW translations and the walk notes; when it cannot,
// the English stays and the zh-TW text is marked untranslated (never a placeholder).
import type { CardDetail, L10n } from "../runtime/cards";
import type { LedgerEntry } from "../runtime/checks";

export type DoneMapLine = { index: number; text: string; proved: boolean; by: { check: string; seq: number; kind?: string }[]; note?: string | null };
export type MergeInput = {
  run: string; intent: string; spec: any; ctx: { door?: any; reviews?: any[]; followups?: string[]; rounds?: any[]; head?: string | null; baseCommit?: string | null; base?: string | null; plan?: any; designScope?: any; designs?: any[] };
  ledger: LedgerEntry[]; doneMap: DoneMapLine[]; diff: string; stat: string;
  cost: { usd: number | null; rounds: number; minutes: number | null } | null;
};
/** what the coordinator agent returns (the card_detail tool's arguments) */
export type Coordinator = {
  intents?: string[]; why?: string[]; how?: string; what?: string; done?: string[]; followups?: string[]; door_reason?: string; rollback?: string;
  walk?: { id: string; en: string; zh: string }[];
};

const CJK = /[㐀-鿿]/;
const zhOk = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && CJK.test(s);
const loc = (en: string, zh: unknown): L10n => (zhOk(zh) ? { en, "zh-TW": zh } : { en, "zh-TW": en, untranslated: true });
const ranges = (ns: number[]) => { const a = [...new Set(ns)].sort((x, y) => x - y).map((n) => n + 1); const out: string[] = [];
  for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : String(a[i])); i = j; } return out; };

/** The captain's sentence split into the lines a merge must meet (sentences, then "X: Y" and ", and"). */
export function intentLines(text: string): string[] {
  const first = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  const parts = first.split(/(?<=[.;!?])\s+(?=[A-Z])|:\s+(?=[a-z0-9"'`(])|,\s+and\s+|;\s+/).map((s) => s.trim().replace(/[.;]$/, "")).filter((s) => s.length > 2);
  return parts.length ? parts : first ? [first] : [];
}

// ---------- diff hunks ----------
export type Hunk = { id: string; file: string; start: number; header: string; lines: string[]; kind: "test" | "doc" | "source"; name: string | null };
const isTest = (f: string) => /(^|\/)(test|tests|__tests__|spec)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isDoc = (f: string) => /\.(md|mdx|txt|rst)$/i.test(f) || /^docs?\//.test(f);
const TEST_START = /^\+\s*(test|it)(\.\w+)?\(\s*(["'`])(.*?)\3/;

/** Parse a unified diff into hunks; a test file's added hunk is split per test block. */
export function parseHunks(diff: string): Hunk[] {
  const out: Hunk[] = []; let file = ""; let cur: { start: number; header: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur || !file) return; const kind = isTest(file) ? "test" : isDoc(file) ? "doc" : "source";
    if (kind === "test" && cur.lines.some((l) => TEST_START.test(l))) {
      // one walk item per test block; added lines before the first test (a describe line) go with the first block
      let blk: string[] = []; let start = cur.start; let name: string | null = null; let line = cur.start;
      const push = () => { if (blk.some((l) => TEST_START.test(l))) out.push({ id: `${file}:${start}`, file, start, header: cur!.header, lines: blk, kind, name }); blk = []; };
      for (const l of cur.lines) {
        const m = TEST_START.exec(l);
        if (m && blk.some((x) => TEST_START.test(x))) push();
        if (m) name = m[4];
        if (l.startsWith("+") && (l.trim() !== "+" || blk.length)) { if (!blk.length) start = line; blk.push(l); }
        if (!l.startsWith("-")) line++;
      }
      push();
    } else out.push({ id: `${file}:${cur.start}`, file, start: cur.start, header: cur.header, lines: cur.lines, kind, name: null });
    cur = null;
  };
  for (const l of String(diff ?? "").split("\n")) {
    let m = /^diff --git a\/(.+?) b\/(.+)$/.exec(l);
    if (m) { flush(); file = m[2]; continue; }
    m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(l);
    if (m) { flush(); cur = { start: Number(m[1]), header: m[2] ?? "", lines: [] }; continue; }
    if (cur && /^[ +\-]/.test(l) && !/^(\+\+\+|---) /.test(l)) cur.lines.push(l);
    else if (cur && l.startsWith("\\")) continue;
  }
  flush();
  return out;
}

// ---------- mapping hunks to intent lines and done lines ----------
const calls = (s: string) => new Set([...String(s).matchAll(/\b([A-Za-z_$][\w$]*)\(([^()]*)\)/g)].map((m) => `${m[1]}(${m[2].replace(/'/g, '"').replace(/\s+/g, "")})`));
const callees = (s: string) => new Set([...String(s).matchAll(/\b([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]));
const ids = (s: string) => new Set(String(s).match(/[A-Za-z_$][\w$]*/g) ?? []);
/** distinctive tokens: quoted strings, numbers of two digits or more, all-caps words */
export function tokens(s: string): Set<string> {
  const t = new Set<string>(); const str = String(s);
  for (const m of str.matchAll(/"([^"\n]{1,60})"|`([^`\n]{1,60})`/g)) { const v = (m[1] ?? m[2]).trim(); if (v) t.add(v); }
  const bare = str.replace(/"[^"\n]*"|`[^`\n]*`/g, " ");
  for (const m of bare.matchAll(/\b\d{2,}\b/g)) t.add(m[0]);
  for (const m of str.matchAll(/\b[A-Z]{2,}\b/g)) t.add(m[0]);
  return t;
}
const added = (h: Hunk) => h.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join("\n");

const STOP = new Set(["that", "this", "with", "from", "into", "have", "should", "must", "will", "would", "could", "their", "there", "when", "then", "than", "them", "they", "what", "which", "while", "every", "each", "only", "also", "like", "make", "give", "keep", "stay", "same"]);
const words = (s: string) => new Set((String(s).toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
const names = (d: string, file: string) => d.includes(file);

export function walkMap(hunks: Hunk[], intents: string[], done: string[]): { hunk: Hunk; serves: { intents: number[]; done: number[] } }[] {
  const it = intents.map(tokens); const iw = intents.map(words); const dc = done.map(calls); const dcallee = done.map((d) => callees(d));
  return hunks.map((h) => {
    const a = added(h); const tk = tokens(a); const aw = words(a);
    // an intent line: half its distinctive tokens (quoted text, numbers, codes) are in the hunk, or two of its words and 40% of them
    const si = intents.map((_, i) => i).filter((i) => { const t = it[i], w = iw[i];
      const th = [...t].filter((x) => tk.has(x)).length; const wh = [...w].filter((x) => aw.has(x)).length;
      return (t.size > 0 && th / t.size >= 0.5) || (w.size > 0 && wh >= 2 && wh / w.size >= 0.4); });
    let sd: number[] = [];
    if (h.kind === "test") {
      // a test block proves the done lines whose calls it makes (the best match); else the done lines that name its file
      const c = calls(a); const score = dc.map((d) => [...d].filter((x) => c.has(x)).length); const best = Math.max(0, ...score);
      sd = best > 0 ? score.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0) : done.map((d, i) => (names(d, h.file) ? i : -1)).filter((i) => i >= 0);
    } else if (h.kind === "source") {
      // a source hunk serves the done lines that call what it changes, or that name its file
      const id = ids(a); sd = dcallee.map((d, i) => ([...d].some((f) => id.has(f) && f.length > 2 && !/^(test|expect|it|describe|toBe)$/.test(f)) || names(done[i], h.file) ? i : -1)).filter((i) => i >= 0);
    }
    return { hunk: h, serves: { intents: si, done: sd } };
  });
}

const changedNames = (h: Hunk) => [...new Set([...added(h).matchAll(/\b(?:function|type|interface|class|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
/** A deterministic note for a walk item, in en and zh-TW (the fallback when the coordinator writes none). */
export function walkNote(h: Hunk, s: { intents: number[]; done: number[] }): L10n {
  const di = ranges(s.done); const ii = ranges(s.intents);
  const enServes = [di.length ? `done line${s.done.length > 1 ? "s" : ""} ${di.join(", ")}` : "", ii.length ? `intent line${s.intents.length > 1 ? "s" : ""} ${ii.join(", ")}` : ""].filter(Boolean).join(" and ");
  const zhServes = [di.length ? `完成條件第 ${di.join("、")} 條` : "", ii.length ? `意圖第 ${ii.join("、")} 條` : ""].filter(Boolean).join("與");
  if (!enServes) return { en: `${h.file}: serves no listed intent or done line; read it closely.`, "zh-TW": `${h.file}：沒有對應任何列出的意圖或完成條件，請仔細看。` };
  if (h.kind === "test") return { en: `Test "${h.name ?? h.file}": proves ${enServes}.`, "zh-TW": `測試「${h.name ?? h.file}」：證明${zhServes}。` };
  if (h.kind === "doc") return { en: `Documents the change in ${h.file}: serves ${enServes}.`, "zh-TW": `在 ${h.file} 說明這個改動：對應${zhServes}。` };
  const names = changedNames(h); const what = names.length ? names.join(", ") : h.file;
  return { en: `Changes ${what}: serves ${enServes}.`, "zh-TW": `修改 ${names.length ? names.join("、") : h.file}：支撐${zhServes}。` };
}

// ---------- the detail ----------
const evidenceHref = (run: string, seq: number, file: string) => `/api/wruns/${run}/evidence?seq=${seq}&file=${encodeURIComponent(file)}`;

/**
 * The coordinator's card_detail answer, checked: its tool arguments reach Studio unchecked, so every field is
 * validated here. `shape` (the fallback detail) also pins the counts and the walk ids. Any malformed field rejects
 * the whole answer: the card then keeps the fallback, its zh-TW lines marked untranslated.
 */
export function validCoordinator(raw: unknown, shape?: CardDetail | null): { ok: true; co: Coordinator } | { ok: false; why: string } {
  const bad = (why: string) => ({ ok: false as const, why });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("the answer is not an object");
  const o = raw as Record<string, unknown>;
  const strs = (k: string, n: number | null, required: boolean) => { const v = o[k]; if (v === undefined && !required) return null;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return `${k} is not a list of strings`;
    if (n != null && v.length !== n) return `${k} has ${v.length} lines, the card has ${n}`; return null; };
  const str = (k: string) => (o[k] === undefined || typeof o[k] === "string" ? null : `${k} is not a string`);
  const ids = shape ? new Set(shape.walk.map((w) => w.id)) : null;
  const walkBad = !Array.isArray(o.walk) ? "walk is not a list"
    : (o.walk as unknown[]).map((w: any) => !w || typeof w !== "object" || typeof w.id !== "string" || typeof w.en !== "string" || typeof w.zh !== "string" ? "a walk note is not {id, en, zh} strings"
      : ids && !ids.has(w.id) ? `walk names an unknown hunk ${String(w.id).slice(0, 60)}` : null).find(Boolean) ?? null;
  const why = strs("intents", shape ? shape.intents.length : null, true) ?? strs("done", shape ? shape.done.length : null, true) ?? walkBad
    ?? strs("why", shape ? shape.why.length : null, false) ?? strs("followups", shape ? shape.review?.followups.length ?? 0 : null, false)
    ?? str("how") ?? str("what") ?? str("door_reason") ?? str("rollback");
  return why ? bad(why) : { ok: true, co: o as Coordinator };
}
/** The detail with the coordinator's answer when it is well formed, else the fallback; never throws on the answer. */
export function coordinatorDetail(i: MergeInput, raw: unknown): CardDetail & { rejected?: string } {
  const fb = mergeDetail(i, null); if (raw == null) return fb;
  const v = validCoordinator(raw, fb);
  return v.ok ? mergeDetail(i, v.co) : { ...fb, rejected: v.why };
}

export function mergeDetail(i: MergeInput, co: Coordinator | null = null): CardDetail {
  // defence in depth: an unchecked object never reaches the field reads below
  if (co != null && !validCoordinator(co).ok) co = null;
  const spec = i.spec ?? {}; const intents = intentLines(i.intent); const done: string[] = spec.done ?? [];
  const bySeq = new Map(i.ledger.map((e) => [e.seq, e]));
  const hunks = parseHunks(i.diff); const map = walkMap(hunks, intents, done);
  const coWalk = new Map((co?.walk ?? []).filter((w) => w && typeof w.id === "string").map((w) => [w.id, w]));
  // the red-on-base test names, so a done line's fail-first proof names the test that was red
  const blockOf = (d: number) => map.filter((m) => m.hunk.kind === "test" && m.serves.done.includes(d)).map((m) => m.hunk.name).filter(Boolean) as string[];
  const doneOut = i.doneMap.map((d) => ({
    text: loc(d.text, co?.done?.[d.index]), proved: d.proved,
    proofs: d.by.map((b) => { const e = bySeq.get(b.seq) as any;
      const red: string[] = Array.isArray(e?.data?.red) ? e.data.red : []; const names = blockOf(d.index);
      const detail = red.length ? (red.filter((r) => names.some((n) => r.includes(n))).join("; ") || red.join("; ")).slice(0, 400)
        : Array.isArray(e?.data?.shards) ? `${e.data.shards.length} shard${e.data.shards.length > 1 ? "s" : ""}, every exit 0` : (e?.findings?.[0]?.message ?? "");
      return { check: b.check, seq: b.seq, verdict: e?.verdict ?? "?", head: e?.head ?? null, detail,
        evidence: (Array.isArray(e?.evidence) ? e.evidence : []).map((f: string) => ({ label: f, href: evidenceHref(i.run, b.seq, f) })) }; }),
  }));
  const kind = i.ctx.door?.door ?? spec.door?.kind ?? null; const one = kind === "one-way"; const baseName = i.ctx.base || "main";
  const reasons = (i.ctx.door?.reasons ?? []).filter((r: any) => r.list !== "trivial").map((r: any) => `${r.path}: ${r.why}`);
  const rollbackEn = one ? `A revert does not undo this${reasons.length ? ` (${reasons.join("; ")})` : ""}.${i.ctx.plan?.rollback ? ` Rollback: ${i.ctx.plan.rollback}` : ""}`
    : `A revert of the merge on ${baseName} undoes it; nothing outside the repository changes.`;
  const rollback = one ? loc(rollbackEn, co?.rollback) : { en: rollbackEn, "zh-TW": `在 ${baseName} 上 revert 這次合併就能還原；repository 以外沒有任何改變。` };
  const images = i.ledger.filter((e) => !i.ctx.head || !e.head || e.head === i.ctx.head).flatMap((e) => (Array.isArray(e.evidence) ? e.evidence : []).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => ({ label: `${e.check} · ${f}`, href: evidenceHref(i.run, e.seq, f) })));
  const lastReport = (i.ctx.rounds ?? []).at(-1)?.report?.summary ?? "";
  const gates = i.ledger.filter((e) => e.check.startsWith("firstmate/gate-") && e.check !== "firstmate/gate-design").slice(-6).map((e: any) => ({ name: e.check.replace("firstmate/gate-", ""), verdict: e.verdict, detail: String(e.data?.detail ?? e.findings?.[0]?.message ?? "") }));
  const followups: string[] = i.ctx.followups ?? [];
  const translated = !!co && [co.intents, co.why, co.done].some((a) => Array.isArray(a) && a.some(zhOk));
  return {
    intent: loc(String(i.intent ?? "").split("\n")[0], co?.intents ? co.intents.join(" ") : null),
    intents: intents.map((t, k) => loc(t, co?.intents?.[k])),
    why: (spec.why ?? []).map((w: string, k: number) => loc(w, co?.why?.[k])),
    how: lastReport ? [loc(lastReport, co?.how)] : [],
    scope: { in: spec.scope ?? [], out: spec.out_of_scope ?? spec.scopeOut ?? [] },
    done: doneOut,
    // the change itself (the spec's what) beside the captures and the diff stat; never the spec's explain block,
    // which is the spec writer's reasoning, not what changed
    beforeAfter: { text: loc(String(spec.what ?? ""), spec.zh?.what ?? co?.what), stat: i.stat, images },
    door: kind || spec.door ? { kind, reason: loc(spec.door?.reason ?? (reasons.join("; ") || ""), co?.door_reason), rollback } : null,
    review: (i.ctx.reviews ?? []).length || followups.length ? { verdicts: (i.ctx.reviews ?? []).map((r: any) => ({ by: String(r.by ?? "reviewer"), verdict: String(r.verdict ?? "?") })), followups: followups.map((f, k) => loc(f, co?.followups?.[k])),
      mode: (i.ctx.reviews ?? []).at(-1)?.mode ?? null, notes: [...((i.ctx.reviews ?? []).at(-1)?.notCovered ?? [])] } : null,
    cost: i.cost, gates, design: designDetail(i),
    walk: map.map(({ hunk, serves }) => { const w = coWalk.get(hunk.id); const fb = walkNote(hunk, serves);
      return { id: hunk.id, file: hunk.file, start: hunk.start, lines: hunk.lines.slice(0, 60), note: w && w.en && zhOk(w.zh) ? { en: w.en, "zh-TW": w.zh } : fb, serves }; }),
    run: i.run, head: i.ctx.head ?? null, base: i.ctx.baseCommit ?? null, writer: translated ? "coordinator" : "fallback",
  };
}

/** The designer round as the merge card shows it; null when the run never reached design-scope (an older run). */
export function designDetail(i: MergeInput): CardDetail["design"] {
  const sc = i.ctx.designScope; const designs = i.ctx.designs ?? [];
  const compare = i.ledger.filter((e) => e.check === "firstmate/designer-compare").at(-1) as any;
  const gate = i.ledger.filter((e) => e.check === "firstmate/gate-design").at(-1) as any;
  if (!sc && !designs.length && !compare) return null;
  const last = designs.at(-1);
  const warnings = compare && compare.verdict !== "pass" ? (compare.findings ?? []).map((f: any) => String(f.message ?? "")).filter(Boolean).slice(0, 8) : [];
  // what the designer had to look at: the pictures, no captures of a declared app (an env gap), or a diff-only review (no app)
  const captures: "seen" | "none-env-gap" | "diff-only" = sc?.route === "gap" ? "none-env-gap" : sc?.diffOnly || last?.diffOnly ? "diff-only" : "seen";
  return {
    applicable: sc ? sc.route !== "none" : designs.length > 0, reason: String(sc?.reason ?? ""), captures,
    verdicts: designs.map((d: any) => ({ by: String(d.by ?? "designer"), verdict: String(d.verdict ?? "?"), head: d.head ?? null })),
    findings: last?.verdict === "REJECT" ? (last.findings ?? []).map((f: any) => ({ page: f.page ?? null, element: f.element ?? null, problem: String(f.problem ?? ""), change: String(f.change ?? "") })) : [],
    seen: Array.isArray(last?.seen) ? last.seen.length : 0,
    compare: compare ? { verdict: String(compare.verdict), warnings } : null,
    gate: gate ? { verdict: String(gate.verdict), detail: String(gate.data?.detail ?? gate.findings?.[0]?.message ?? "") } : null,
  };
}
/** the design section of the merge card's text body */
export function designText(d: CardDetail["design"]): string {
  if (!d) return "";
  const gate = d.gate ? `\nDesign gate: ${d.gate.verdict === "pass" ? "✓" : "✗"} ${d.gate.detail}` : "";
  if (!d.applicable) return `\n\nDesigner: not applicable (${d.reason.replace(/^not applicable: /, "") || "no UI path changed"}).${gate}`;
  const last = d.verdicts.at(-1);
  const saw = d.captures === "none-env-gap" ? "no captures (an env gap: the app's pages were not captured)" : d.captures === "diff-only" ? "diff-only, no pictures (the repository declares no app)" : `saw ${d.seen} capture${d.seen === 1 ? "" : "s"}`;
  return `\n\nDesigner: ${last ? `${last.verdict} by ${last.by}${last.head ? ` at ${String(last.head).slice(0, 8)}` : ""}; ${saw}` : `no verdict; ${saw}`}${d.verdicts.length > 1 ? `\nEarlier: ${d.verdicts.slice(0, -1).map((v) => v.verdict).join(", ")}` : ""}`
    + (d.findings.length ? `\n${d.findings.map((f, k) => `${k + 1}. ${f.page ?? "the UI"}${f.element ? ` ${f.element}` : ""}: ${f.problem} → ${f.change}`).join("\n")}` : "")
    + (d.compare?.warnings.length ? `\nDesigner-compare (${d.compare.verdict}):\n${d.compare.warnings.map((w) => `- ${w}`).join("\n")}` : "") + gate;
}

/** The coordinator's turn: what it reads (the fallback detail) and the one tool it calls. */
export function coordinatorText(d: CardDetail): string {
  return [
    "MERGE CARD DETAIL",
    "Translate every line below into Traditional Chinese (zh-TW) for the captain, plain words, keep code, file names and numbers as they are.",
    "Write one short walk note per hunk (en and zh) that says which intent line or done line it serves. Call card_detail exactly once.",
    "", "Captain's intent lines:", ...d.intents.map((t, k) => `${k + 1}. ${t.en}`),
    "", "Why:", ...d.why.map((t, k) => `${k + 1}. ${t.en}`),
    "", `How (worker's report): ${d.how[0]?.en ?? ""}`,
    "", `What changes (before and after): ${d.beforeAfter.text.en}`,
    "", "Done lines:", ...d.done.map((t, k) => `${k + 1}. ${t.text.en}`),
    "", "Follow-ups:", ...(d.review?.followups ?? []).map((t, k) => `${k + 1}. ${t.en}`),
    "", `Door reason: ${d.door?.reason.en ?? ""}`, d.door?.kind === "one-way" ? `Rollback: ${d.door?.rollback.en ?? ""}` : "",
    "", "Hunks (id, what it serves, lines):",
    ...d.walk.map((w) => `--- ${w.id} (intents ${w.serves.intents.map((n) => n + 1).join(",") || "-"}; done ${w.serves.done.map((n) => n + 1).join(",") || "-"})\n${w.lines.slice(0, 30).join("\n")}`),
  ].join("\n").slice(0, 40000);
}
export const COORDINATOR_TOOL_SCHEMA = { type: "object", properties: {
  intents: { type: "array", items: { type: "string" }, description: "zh-TW of each intent line, same order" },
  why: { type: "array", items: { type: "string" } }, how: { type: "string" }, what: { type: "string", description: "zh-TW of What changes" }, done: { type: "array", items: { type: "string" } },
  followups: { type: "array", items: { type: "string" } }, door_reason: { type: "string" }, rollback: { type: "string" },
  walk: { type: "array", items: { type: "object", properties: { id: { type: "string" }, en: { type: "string" }, zh: { type: "string" } }, required: ["id", "en", "zh"] } },
}, required: ["intents", "done", "walk"] };
