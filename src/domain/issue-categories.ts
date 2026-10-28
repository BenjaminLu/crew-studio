// A project's issue categories (docs/units/board.md, "Issue categories"): its GitHub issues filed into categories kept in
// Studio, never as GitHub labels. A category is work a lead hands to one engineer together: one product area or kind of
// work, root causes may differ. Security is a flag on an issue, never a category.
// The first run builds the list; every later run files only the issues not filed yet into it and proposes a new category
// only when none fits. Categories a run proposes wait for the captain; the captain's own edits (rename, move, merge) are
// never overwritten by a run, and a project that has a list is never built again from scratch.
// Planned work (roadmap and program tasks, plans, process work) is tagged PLANNED in Studio and set aside: it is not handed
// out by category. The categorizer proposes the tag; it is set only once the captain approves it on the run's card, so an
// issue's own text ("this is a roadmap tracking issue") never takes it out of the work queue alone. A security issue (a
// security label, or security words in its title: SECURITY_TITLE) is never tagged by a run: it goes into a category.
// The captain moves an issue in or out of the tag.
import { SECURITY_LABEL } from "./issue-triage";

export type CategoryStatus = "proposed" | "active" | "declined" | "merged";
export type Category = { id: string; name: string; scope: string; status: CategoryStatus; createdAt: string; createdBy: string; mergedInto?: string; decidedBy?: string };
export type Assignment = { category: string; by: "model" | "captain"; at: string; why?: string; run?: string; hash?: string;
  /** the captain took it off planned work: no run tags it planned again */
  notPlanned?: true;
  /** a run proposed it as planned work: not set aside until the captain approves (decidePlanned) */
  pending?: true;
  /** who approved a run's planned work, and when */
  decidedBy?: string };
export type CategoryRun = { run: string; at: string; mode: "build" | "file"; filed: number; proposed: string[]; model: string };
export type CategoryRecord = { schema: 1; project: string; repository: string; categories: Category[]; assignments: Record<string, Assignment>; lastCategory: number; runs: CategoryRun[]; updatedAt: string;
  /** the titles of the issues runs read (untrusted text: the page shows them as text only) */
  titles?: Record<string, string>;
  /** the open issues at the last read: the page counts these */
  open?: number[] };
export const PLANNED = "PLANNED";
export type BuildReport = { categories: { name: string; scope: string; issues: number[] }[]; planned?: { n: number; why: string }[] };
export type FileReport = { assign: { n: number; category: string; new_name?: string; new_scope?: string; why: string }[] };
type Snap = { issues: { n: number; hash?: string; title?: string; labels?: string[] }[] };
const titlesOf = (prev: Record<string, string> | undefined, s: Snap) => ({ ...(prev ?? {}), ...Object.fromEntries(s.issues.filter((i) => typeof i.title === "string").map((i) => [String(i.n), i.title!.slice(0, 300)])) });
const MAX_CATEGORIES = 40, NAME = 60, SCOPE = 300, WHY = 300;
// a category whose subject is security itself: security is a flag on issues of every area
const SECURITY_ONLY = /^(app(lication)?\s*)?(security|sec)\b|^(應用|应用)?安全|安全(漏洞|問題|问题|審查|审查)|資安|资安|資訊安全|信息安全|vulnerabilit|\bcve/i;
// one line of plain text: no control characters or markup that could pass for Studio's own words on a card
const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f<>]/.test(v);
const bad = (why: string): never => { throw new Error(`The categories report does not follow the skill format: ${why}`); };
/** Security words in an issue title (case-insensitive, whole words; the title is NFKC-cleaned when read): security, a
 *  vulnerability, an exploit, a CVE, XSS, CSRF, SSRF, RCE, an injection, an auth or permission bypass, privilege
 *  escalation, a leaked secret, token, credential or key, 資安 / 资安, 安全, 漏洞. Deterministic, and broad on purpose: a
 *  false match only means the issue is filed into a category instead of set aside. */
export const SECURITY_TITLE = /\b(?:security|insecure|vulnerab\w*|exploit\w*|cve-?\d*|xss|csrf|ssrf|rce|\w*injection|(?:auth\w*|permission|access)\s+bypass|privilege\s+escalation|leak\w*\s+(?:\w+\s+)?(?:secrets?|tokens?|credentials?|keys?|passwords?)|(?:secrets?|tokens?|credentials?|passwords?)\s+leak\w*)\b|資安|资安|安全|漏洞/i;
/** The issues of a read that may never be set aside as planned work: a security label (as triage reads it) or security words
 *  in the title. */
export const securityIssues = (s: Snap) => new Set(s.issues.filter((i) => (i.labels ?? []).some((l) => SECURITY_LABEL.test(l)) || SECURITY_TITLE.test(i.title ?? "")).map((i) => i.n));
const notSecurity = (n: number, secure: Set<number>) => { if (secure.has(n)) bad(`#${n} is a security issue (a security label, or security words in its title): file it into a category, never PLANNED`); };

/** each issue of the batch exactly once, none outside it */
function exactlyOnce(placed: number[], batch: number[]) {
  const seen = new Set<number>(), b = new Set(batch);
  for (const n of placed) { if (!Number.isSafeInteger(n)) bad(`issue number ${n}`); if (!b.has(n)) bad(`#${n} is not in this batch`); if (seen.has(n)) bad(`#${n} is filed twice`); seen.add(n); }
  const left = batch.filter((n) => !seen.has(n)); if (left.length) bad(`${left.map((n) => `#${n}`).join(" ")} not filed`);
}
const nameOk = (name: string, scope: string, taken: Set<string>) => {
  if (!str(name, NAME)) bad(`category name "${String(name).slice(0, 80)}"`);
  if (!str(scope, SCOPE)) bad(`category "${name}" needs a scope (one sentence on what belongs in it)`);
  if (SECURITY_ONLY.test(name.trim())) bad(`"${name}": security is a flag on an issue, not a category; file it by product area or kind of work`);
  const k = name.trim().toLowerCase(); if (taken.has(k)) bad(`two categories share the name "${name}"`); taken.add(k);
};

/** The first run's report: the categories, each with a scope and its issues; planned work never holds a security issue. */
export function parseBuild(raw: any, batch: number[], keep: Set<number> = new Set(), secure: Set<number> = new Set()): BuildReport {
  const planned = raw?.planned ?? [];
  if (!Array.isArray(planned)) bad("planned");
  if (!raw || !Array.isArray(raw.categories) || (!raw.categories.length && !planned.length) || raw.categories.length > MAX_CATEGORIES) bad(`categories (1 to ${MAX_CATEGORIES})`);
  const taken = new Set<string>();
  for (const c of raw.categories) { if (!c || !Array.isArray(c.issues) || !c.issues.length) bad("a category without issues"); nameOk(c.name, c.scope, taken); }
  for (const p of planned) { if (!p || !str(p.why, WHY)) bad(`planned #${p?.n ?? "?"} needs a short why`); if (keep.has(Number(p.n))) bad(`the captain took #${p.n} off planned work: file it into a category`); notSecurity(Number(p.n), secure); }
  exactlyOnce([...raw.categories.flatMap((c: any) => c.issues), ...planned.map((p: any) => p.n)], batch);
  return { categories: raw.categories.map((c: any) => ({ name: c.name.trim(), scope: c.scope.trim(), issues: c.issues.map(Number) })), planned: planned.map((p: any) => ({ n: Number(p.n), why: p.why.trim() })) };
}
const live = (rec: CategoryRecord) => new Map(rec.categories.filter((c) => c.status === "active" || c.status === "proposed").map((c) => [c.id, c]));
/** A later run's report: each issue into an existing category, or NEW with a name, a scope and why none fits, or PLANNED
 *  (never a security issue). */
export function parseFile(raw: any, batch: number[], rec: CategoryRecord, secure: Set<number> = new Set()): FileReport {
  if (!raw || !Array.isArray(raw.assign)) bad("assign");
  const ok = live(rec), taken = new Set([...ok.values()].map((c) => c.name.trim().toLowerCase())), fresh = new Map<string, string>(), declined = new Set(declinedNames(rec).map((n) => n.toLowerCase()));
  for (const a of raw.assign) {
    if (!a || !str(a.why, WHY)) bad(`#${a?.n ?? "?"} needs a short why`);
    if (a.category === "NEW") {
      const k = String(a.new_name ?? "").trim().toLowerCase();
      if (declined.has(k)) bad(`the captain declined a category named "${a.new_name}": file #${a.n} into an existing category, or name a different one`);
      if (fresh.has(k)) { if (fresh.get(k) !== a.new_scope) bad(`new category "${a.new_name}" has two scopes`); continue; }
      nameOk(a.new_name, a.new_scope, taken); fresh.set(k, a.new_scope);
    } else if (a.category === PLANNED) { if (notPlanned(rec).has(Number(a.n))) bad(`the captain took #${a.n} off planned work: file it into a category`); notSecurity(Number(a.n), secure); }
    else if (!ok.has(a.category)) bad(`#${a.n} names ${a.category}, which is not an open category`);
  }
  exactlyOnce(raw.assign.map((a: any) => Number(a.n)), batch);
  return { assign: raw.assign.map((a: any) => ({ n: Number(a.n), category: a.category, why: a.why.trim(), ...(a.category === "NEW" ? { new_name: a.new_name.trim(), new_scope: a.new_scope.trim() } : {}) })) };
}

// a run files an issue unless the captain placed it; one the captain only took off planned work waits to be filed
const fileable = (a: Assignment | undefined) => a?.by !== "captain" || (a.notPlanned === true && !a.category);
const kept = (a: Assignment | undefined) => (a?.notPlanned ? { notPlanned: true as const } : {});
type RunInfo = { run: string; model: string; at: string; snapshot: Snap };
const hashOf = (s: Snap) => new Map(s.issues.map((i) => [i.n, i.hash]));
/** The first run: the list as proposals the captain approves, its issues filed into them; its planned work waits too. */
export function applyBuild(prev: CategoryRecord | null, r: BuildReport, o: RunInfo & { project: string; repository: string }): CategoryRecord {
  if (prev && prev.categories.some((c) => c.status === "active" || c.status === "proposed")) throw new Error(`${o.project} already has categories: later runs file new issues into them`);
  let last = prev?.lastCategory ?? 0; const h = hashOf(o.snapshot), categories: Category[] = [...(prev?.categories ?? [])], assignments: Record<string, Assignment> = { ...(prev?.assignments ?? {}) };
  for (const c of r.categories) { const id = `C-${++last}`; categories.push({ id, name: c.name, scope: c.scope, status: "proposed", createdAt: o.at, createdBy: `${o.run} (${o.model})` });
    for (const n of c.issues) if (fileable(assignments[String(n)])) assignments[String(n)] = { category: id, by: "model", at: o.at, run: o.run, hash: h.get(n), ...kept(assignments[String(n)]) }; }
  for (const p of r.planned ?? []) if (assignments[String(p.n)]?.by !== "captain") assignments[String(p.n)] = { category: PLANNED, by: "model", at: o.at, why: p.why, run: o.run, hash: h.get(p.n), pending: true };
  const proposed = categories.filter((c) => c.status === "proposed").map((c) => c.id);
  return { schema: 1, project: o.project, repository: o.repository, categories, assignments, lastCategory: last, runs: [...(prev?.runs ?? []), { run: o.run, at: o.at, mode: "build", filed: r.categories.reduce((a, c) => a + c.issues.length, 0) + (r.planned?.length ?? 0), proposed, model: o.model }], updatedAt: o.at, titles: titlesOf(prev?.titles, o.snapshot), open: o.snapshot.issues.map((i) => i.n) };
}
/** A later run: issues into existing categories at once; the NEW ones into one proposed category per new name, and the
 *  PLANNED ones proposed as planned work, both waiting for the captain. */
export function applyFile(rec: CategoryRecord, r: FileReport, o: RunInfo): CategoryRecord {
  let last = rec.lastCategory; const h = hashOf(o.snapshot), categories = [...rec.categories], assignments = { ...rec.assignments }, made = new Map<string, string>(), proposed: string[] = [];
  // the list as it is now: the captain may have merged or renamed while the categorizer ran
  const byName = new Map([...live(rec).values()].map((c) => [c.name.trim().toLowerCase(), c.id])), declined = new Set(declinedNames(rec).map((n) => n.toLowerCase()));
  const follow = (id: string) => { for (let i = 0; i < 20; i++) { const c = rec.categories.find((x) => x.id === id); if (!c) return null; if (c.status === "merged" && c.mergedInto) { id = c.mergedInto; continue; } return c.status === "active" || c.status === "proposed" ? id : null; } return null; };
  let filed = 0;
  for (const a of r.assign) {
    const was = assignments[String(a.n)];
    if (!fileable(was)) continue;
    let id: string | null = a.category;
    if (id === PLANNED) { if (was?.notPlanned) continue; /* set aside: no category */ }
    else if (id !== "NEW") { id = follow(id); if (!id) continue; } // a category gone meanwhile: the issue stays unfiled for the next run
    else if (byName.has(a.new_name!.toLowerCase())) id = byName.get(a.new_name!.toLowerCase())!;
    else if (declined.has(a.new_name!.toLowerCase())) continue; // declined while the categorizer ran: the issue waits for the next run
    else { const k = a.new_name!.toLowerCase(); id = made.get(k) ?? "";
      if (!id) { id = `C-${++last}`; made.set(k, id); proposed.push(id); categories.push({ id, name: a.new_name!, scope: a.new_scope!, status: "proposed", createdAt: o.at, createdBy: `${o.run} (${o.model})` }); } }
    assignments[String(a.n)] = { category: id!, by: "model", at: o.at, why: a.why, run: o.run, hash: h.get(a.n), ...kept(was), ...(id === PLANNED ? { pending: true as const } : {}) }; filed++;
  }
  return { ...rec, categories, assignments, lastCategory: last, runs: [...rec.runs, { run: o.run, at: o.at, mode: "file", filed, proposed, model: o.model }], updatedAt: o.at, titles: titlesOf(rec.titles, o.snapshot), open: o.snapshot.issues.map((i) => i.n) };
}
type Who = { by: string; at: string };
const decide = (rec: CategoryRecord, ids: string[], status: "active" | "declined", w: Who) => {
  for (const id of ids) { const c = rec.categories.find((x) => x.id === id); if (!c) throw new Error(`No category ${id}`); if (c.status !== "proposed") throw new Error(`${id} is ${c.status}, not waiting for approval`); }
  return { ...rec, categories: rec.categories.map((c) => (ids.includes(c.id) ? { ...c, status, decidedBy: `${w.by} ${w.at}` } : c)), updatedAt: w.at };
};
export const approveCategories = (rec: CategoryRecord, ids: string[], w: Who) => decide(rec, ids, "active", w);
/** The issues a run proposed as planned work, still waiting for the captain. */
export const pendingPlanned = (rec: CategoryRecord, run?: string) => Object.entries(rec.assignments).filter(([, a]) => a.category === PLANNED && a.pending && (!run || a.run === run)).map(([n]) => Number(n)).sort((a, b) => a - b);
/** The captain's answer to planned work a run proposed: approved, it is set aside; declined, the issue is the captain's "not
 *  planned" (the next run files it into a category and never tags it planned again). */
export function decidePlanned(rec: CategoryRecord, ns: number[], choice: "approve" | "decline", w: Who): CategoryRecord {
  const assignments = { ...rec.assignments };
  for (const n of ns) { const a = assignments[String(n)]; if (a?.category !== PLANNED || !a.pending) continue;
    if (choice === "approve") { const { pending: _p, ...set } = a; assignments[String(n)] = { ...set, decidedBy: `${w.by} ${w.at}` }; }
    else assignments[String(n)] = { category: "", by: "captain", at: w.at, why: `declined as planned work by ${w.by}`, notPlanned: true }; }
  return { ...rec, assignments, updatedAt: w.at };
}
/** A declined category releases its issues: the next run files them again. */
export function declineCategories(rec: CategoryRecord, ids: string[], w: Who): CategoryRecord {
  // the captain's "not planned" outlives the category: the issue is released, the call kept
  const out = decide(rec, ids, "declined", w), assignments = Object.fromEntries(Object.entries(out.assignments).flatMap(([n, a]) => (!ids.includes(a.category) ? [[n, a]] : a.notPlanned ? [[n, { category: "", by: "captain" as const, at: w.at, notPlanned: true as const }]] : [])));
  return { ...out, assignments };
}
export type Edit = { op: "rename"; id: string; name: string } | { op: "move"; n: number; to: string } | { op: "merge"; id: string; into: string } | { op: "approve" | "decline"; ids: string[] } | { op: "unplan"; n: number };
/** the names the captain declined, and no live category holds again: the next brief lists them, and no run proposes them again */
/** the issues the captain took off planned work: the brief lists them, and no run tags them planned again */
export const notPlanned = (rec: CategoryRecord | null) => new Set(Object.entries(rec?.assignments ?? {}).filter(([, a]) => a.notPlanned).map(([n]) => Number(n)));
export const declinedNames = (rec: CategoryRecord) => { const held = new Set([...live(rec).values()].map((c) => c.name.trim().toLowerCase()));
  return [...new Set(rec.categories.filter((c) => c.status === "declined" && !held.has(c.name.trim().toLowerCase())).map((c) => c.name))]; };
/** The captain's edits on the project page. They are the captain's: a later run never undoes them. */
export function editCategories(rec: CategoryRecord, e: Edit, w: Who): CategoryRecord {
  // proposals a run left (its card closed with the run): decided here as on the card
  if (e.op === "approve") return approveCategories(rec, e.ids, w);
  if (e.op === "decline") return declineCategories(rec, e.ids, w);
  const act = (id: string) => { const c = rec.categories.find((x) => x.id === id); if (!c || c.status !== "active") throw new Error(`${id} is not an active category`); return c; };
  if (e.op === "rename") { act(e.id); const taken = new Set(rec.categories.filter((c) => c.id !== e.id && c.status !== "declined" && c.status !== "merged").map((c) => c.name.trim().toLowerCase()));
    nameOk(e.name, act(e.id).scope, taken); return { ...rec, categories: rec.categories.map((c) => (c.id === e.id ? { ...c, name: e.name.trim() } : c)), updatedAt: w.at }; }
  if (e.op === "unplan") { if (rec.assignments[String(e.n)]?.category !== PLANNED) throw new Error(`#${e.n} is not planned work`);
    return { ...rec, assignments: { ...rec.assignments, [String(e.n)]: { category: "", by: "captain", at: w.at, why: `taken off planned work by ${w.by}`, notPlanned: true } }, updatedAt: w.at }; }
  if (e.op === "move") { if (e.to !== PLANNED) act(e.to); if (!Number.isSafeInteger(e.n)) throw new Error("issue number");
    return { ...rec, assignments: { ...rec.assignments, [String(e.n)]: { category: e.to, by: "captain", at: w.at, why: e.to === PLANNED ? `tagged planned by ${w.by}` : `moved by ${w.by}` } }, updatedAt: w.at }; }
  act(e.id); act(e.into); if (e.id === e.into) throw new Error("merge into another category");
  const assignments = Object.fromEntries(Object.entries(rec.assignments).map(([n, a]) => [n, a.category === e.id ? { ...a, category: e.into, by: "captain" as const, at: w.at, why: `merged by ${w.by}` } : a]));
  return { ...rec, categories: rec.categories.map((c) => (c.id === e.id ? { ...c, status: "merged" as const, mergedInto: e.into, decidedBy: `${w.by} ${w.at}` } : c)), assignments, updatedAt: w.at };
}
/** The open issues no category holds yet (or whose category was declined): what the next run files. */
export function unfiled(rec: CategoryRecord | null, open: Snap): number[] {
  const ok = rec ? live(rec) : new Map();
  return open.issues.map((i) => i.n).filter((n) => { const c = rec?.assignments[String(n)]?.category ?? ""; return c !== PLANNED && !ok.has(c); }).sort((a, b) => a - b);
}
/** The (open) issues set aside as planned work, each with why; pending: a run proposed it and the captain has not decided. */
export function planned(rec: CategoryRecord, open?: Snap) {
  const isOpen = open ? new Set(open.issues.map((i) => i.n)) : rec.open ? new Set(rec.open) : null;
  return Object.entries(rec.assignments).filter(([n, a]) => a.category === PLANNED && (!isOpen || isOpen.has(Number(n)))).map(([n, a]) => ({ n: Number(n), why: a.why ?? "", by: a.by, pending: !!a.pending })).sort((a, b) => a.n - b.n);
}
/** Each active or proposed category with its (open) issues. */
export function counts(rec: CategoryRecord, open?: Snap) {
  const isOpen = open ? new Set(open.issues.map((i) => i.n)) : rec.open ? new Set(rec.open) : null;
  return rec.categories.filter((c) => c.status === "active" || c.status === "proposed").map((c) => ({ ...c,
    issues: Object.entries(rec.assignments).filter(([n, a]) => a.category === c.id && (!isOpen || isOpen.has(Number(n)))).map(([n]) => Number(n)).sort((a, b) => a - b) }));
}
/** A read of the open issues, recorded on the existing record so the page's counts follow GitHub even when nothing is filed. */
export const withOpen = (rec: CategoryRecord, open: Snap): CategoryRecord => ({ ...rec, open: open.issues.map((i) => i.n) });
