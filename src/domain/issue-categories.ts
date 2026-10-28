// A project's issue categories (docs/units/board.md, "Issue categories"): its GitHub issues filed into categories kept in
// Studio, never as GitHub labels. A category is work a lead hands to one engineer together: one product area or kind of
// work, root causes may differ. Security is a flag on an issue, never a category.
// The first run builds the list; every later run files only the issues not filed yet into it and proposes a new category
// only when none fits. Categories a run proposes wait for the captain; the captain's own edits (rename, move, merge) are
// never overwritten by a run, and a project that has a list is never built again from scratch.

export type CategoryStatus = "proposed" | "active" | "declined" | "merged";
export type Category = { id: string; name: string; scope: string; status: CategoryStatus; createdAt: string; createdBy: string; mergedInto?: string; decidedBy?: string };
export type Assignment = { category: string; by: "model" | "captain"; at: string; why?: string; run?: string; hash?: string };
export type CategoryRun = { run: string; at: string; mode: "build" | "file"; filed: number; proposed: string[]; model: string };
export type CategoryRecord = { schema: 1; project: string; repository: string; categories: Category[]; assignments: Record<string, Assignment>; lastCategory: number; runs: CategoryRun[]; updatedAt: string;
  /** the titles of the issues runs read (untrusted text: the page shows them as text only) */
  titles?: Record<string, string>;
  /** the open issues at the last read: the page counts these */
  open?: number[] };
export type BuildReport = { categories: { name: string; scope: string; issues: number[] }[] };
export type FileReport = { assign: { n: number; category: string; new_name?: string; new_scope?: string; why: string }[] };
type Snap = { issues: { n: number; hash?: string; title?: string }[] };
const titlesOf = (prev: Record<string, string> | undefined, s: Snap) => ({ ...(prev ?? {}), ...Object.fromEntries(s.issues.filter((i) => typeof i.title === "string").map((i) => [String(i.n), i.title!.slice(0, 300)])) });
const MAX_CATEGORIES = 40, NAME = 60, SCOPE = 300, WHY = 300;
// a category whose subject is security itself: security is a flag on issues of every area
const SECURITY_ONLY = /^(app(lication)?\s*)?(security|sec)\b|^(應用|应用)?安全|安全(漏洞|問題|问题|審查|审查)|資安|资安|資訊安全|信息安全|vulnerabilit|\bcve/i;
// one line of plain text: no control characters or markup that could pass for Studio's own words on a card
const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f<>]/.test(v);
const bad = (why: string): never => { throw new Error(`The categories report does not follow the skill format: ${why}`); };

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

/** The first run's report: the categories, each with a scope and its issues. */
export function parseBuild(raw: any, batch: number[]): BuildReport {
  if (!raw || !Array.isArray(raw.categories) || !raw.categories.length || raw.categories.length > MAX_CATEGORIES) bad(`categories (1 to ${MAX_CATEGORIES})`);
  const taken = new Set<string>();
  for (const c of raw.categories) { if (!c || !Array.isArray(c.issues) || !c.issues.length) bad("a category without issues"); nameOk(c.name, c.scope, taken); }
  exactlyOnce(raw.categories.flatMap((c: any) => c.issues), batch);
  return { categories: raw.categories.map((c: any) => ({ name: c.name.trim(), scope: c.scope.trim(), issues: c.issues.map(Number) })) };
}
const live = (rec: CategoryRecord) => new Map(rec.categories.filter((c) => c.status === "active" || c.status === "proposed").map((c) => [c.id, c]));
/** A later run's report: each issue into an existing category, or NEW with a name, a scope and why none fits. */
export function parseFile(raw: any, batch: number[], rec: CategoryRecord): FileReport {
  if (!raw || !Array.isArray(raw.assign)) bad("assign");
  const ok = live(rec), taken = new Set([...ok.values()].map((c) => c.name.trim().toLowerCase())), fresh = new Map<string, string>(), declined = new Set(declinedNames(rec).map((n) => n.toLowerCase()));
  for (const a of raw.assign) {
    if (!a || !str(a.why, WHY)) bad(`#${a?.n ?? "?"} needs a short why`);
    if (a.category === "NEW") {
      const k = String(a.new_name ?? "").trim().toLowerCase();
      if (declined.has(k)) bad(`the captain declined a category named "${a.new_name}": file #${a.n} into an existing category, or name a different one`);
      if (fresh.has(k)) { if (fresh.get(k) !== a.new_scope) bad(`new category "${a.new_name}" has two scopes`); continue; }
      nameOk(a.new_name, a.new_scope, taken); fresh.set(k, a.new_scope);
    } else if (!ok.has(a.category)) bad(`#${a.n} names ${a.category}, which is not an open category`);
  }
  exactlyOnce(raw.assign.map((a: any) => Number(a.n)), batch);
  return { assign: raw.assign.map((a: any) => ({ n: Number(a.n), category: a.category, why: a.why.trim(), ...(a.category === "NEW" ? { new_name: a.new_name.trim(), new_scope: a.new_scope.trim() } : {}) })) };
}

type RunInfo = { run: string; model: string; at: string; snapshot: Snap };
const hashOf = (s: Snap) => new Map(s.issues.map((i) => [i.n, i.hash]));
/** The first run: the list as proposals the captain approves, its issues filed into them. */
export function applyBuild(prev: CategoryRecord | null, r: BuildReport, o: RunInfo & { project: string; repository: string }): CategoryRecord {
  if (prev && prev.categories.some((c) => c.status === "active" || c.status === "proposed")) throw new Error(`${o.project} already has categories: later runs file new issues into them`);
  let last = prev?.lastCategory ?? 0; const h = hashOf(o.snapshot), categories: Category[] = [...(prev?.categories ?? [])], assignments: Record<string, Assignment> = { ...(prev?.assignments ?? {}) };
  for (const c of r.categories) { const id = `C-${++last}`; categories.push({ id, name: c.name, scope: c.scope, status: "proposed", createdAt: o.at, createdBy: `${o.run} (${o.model})` });
    for (const n of c.issues) if (assignments[String(n)]?.by !== "captain") assignments[String(n)] = { category: id, by: "model", at: o.at, run: o.run, hash: h.get(n) }; }
  const proposed = categories.filter((c) => c.status === "proposed").map((c) => c.id);
  return { schema: 1, project: o.project, repository: o.repository, categories, assignments, lastCategory: last, runs: [...(prev?.runs ?? []), { run: o.run, at: o.at, mode: "build", filed: r.categories.reduce((a, c) => a + c.issues.length, 0), proposed, model: o.model }], updatedAt: o.at, titles: titlesOf(prev?.titles, o.snapshot), open: o.snapshot.issues.map((i) => i.n) };
}
/** A later run: issues into existing categories; the NEW ones into one proposed category per new name. */
export function applyFile(rec: CategoryRecord, r: FileReport, o: RunInfo): CategoryRecord {
  let last = rec.lastCategory; const h = hashOf(o.snapshot), categories = [...rec.categories], assignments = { ...rec.assignments }, made = new Map<string, string>(), proposed: string[] = [];
  // the list as it is now: the captain may have merged or renamed while the categorizer ran
  const byName = new Map([...live(rec).values()].map((c) => [c.name.trim().toLowerCase(), c.id])), declined = new Set(declinedNames(rec).map((n) => n.toLowerCase()));
  const follow = (id: string) => { for (let i = 0; i < 20; i++) { const c = rec.categories.find((x) => x.id === id); if (!c) return null; if (c.status === "merged" && c.mergedInto) { id = c.mergedInto; continue; } return c.status === "active" || c.status === "proposed" ? id : null; } return null; };
  let filed = 0;
  for (const a of r.assign) {
    if (assignments[String(a.n)]?.by === "captain") continue;
    let id: string | null = a.category;
    if (id !== "NEW") { id = follow(id); if (!id) continue; } // a category gone meanwhile: the issue stays unfiled for the next run
    else if (byName.has(a.new_name!.toLowerCase())) id = byName.get(a.new_name!.toLowerCase())!;
    else if (declined.has(a.new_name!.toLowerCase())) continue; // declined while the categorizer ran: the issue waits for the next run
    else { const k = a.new_name!.toLowerCase(); id = made.get(k) ?? "";
      if (!id) { id = `C-${++last}`; made.set(k, id); proposed.push(id); categories.push({ id, name: a.new_name!, scope: a.new_scope!, status: "proposed", createdAt: o.at, createdBy: `${o.run} (${o.model})` }); } }
    assignments[String(a.n)] = { category: id!, by: "model", at: o.at, why: a.why, run: o.run, hash: h.get(a.n) }; filed++;
  }
  return { ...rec, categories, assignments, lastCategory: last, runs: [...rec.runs, { run: o.run, at: o.at, mode: "file", filed, proposed, model: o.model }], updatedAt: o.at, titles: titlesOf(rec.titles, o.snapshot), open: o.snapshot.issues.map((i) => i.n) };
}
type Who = { by: string; at: string };
const decide = (rec: CategoryRecord, ids: string[], status: "active" | "declined", w: Who) => {
  for (const id of ids) { const c = rec.categories.find((x) => x.id === id); if (!c) throw new Error(`No category ${id}`); if (c.status !== "proposed") throw new Error(`${id} is ${c.status}, not waiting for approval`); }
  return { ...rec, categories: rec.categories.map((c) => (ids.includes(c.id) ? { ...c, status, decidedBy: `${w.by} ${w.at}` } : c)), updatedAt: w.at };
};
export const approveCategories = (rec: CategoryRecord, ids: string[], w: Who) => decide(rec, ids, "active", w);
/** A declined category releases its issues: the next run files them again. */
export function declineCategories(rec: CategoryRecord, ids: string[], w: Who): CategoryRecord {
  const out = decide(rec, ids, "declined", w), assignments = Object.fromEntries(Object.entries(out.assignments).filter(([, a]) => !ids.includes(a.category)));
  return { ...out, assignments };
}
export type Edit = { op: "rename"; id: string; name: string } | { op: "move"; n: number; to: string } | { op: "merge"; id: string; into: string } | { op: "approve" | "decline"; ids: string[] };
/** the names the captain declined: the next brief lists them, and no run proposes them again */
export const declinedNames = (rec: CategoryRecord) => [...new Set(rec.categories.filter((c) => c.status === "declined").map((c) => c.name))];
/** The captain's edits on the project page. They are the captain's: a later run never undoes them. */
export function editCategories(rec: CategoryRecord, e: Edit, w: Who): CategoryRecord {
  // proposals a run left (its card closed with the run): decided here as on the card
  if (e.op === "approve") return approveCategories(rec, e.ids, w);
  if (e.op === "decline") return declineCategories(rec, e.ids, w);
  const act = (id: string) => { const c = rec.categories.find((x) => x.id === id); if (!c || c.status !== "active") throw new Error(`${id} is not an active category`); return c; };
  if (e.op === "rename") { act(e.id); const taken = new Set(rec.categories.filter((c) => c.id !== e.id && c.status !== "declined" && c.status !== "merged").map((c) => c.name.trim().toLowerCase()));
    nameOk(e.name, act(e.id).scope, taken); return { ...rec, categories: rec.categories.map((c) => (c.id === e.id ? { ...c, name: e.name.trim() } : c)), updatedAt: w.at }; }
  if (e.op === "move") { act(e.to); if (!Number.isSafeInteger(e.n)) throw new Error("issue number");
    return { ...rec, assignments: { ...rec.assignments, [String(e.n)]: { category: e.to, by: "captain", at: w.at, why: `moved by ${w.by}` } }, updatedAt: w.at }; }
  act(e.id); act(e.into); if (e.id === e.into) throw new Error("merge into another category");
  const assignments = Object.fromEntries(Object.entries(rec.assignments).map(([n, a]) => [n, a.category === e.id ? { ...a, category: e.into, by: "captain" as const, at: w.at, why: `merged by ${w.by}` } : a]));
  return { ...rec, categories: rec.categories.map((c) => (c.id === e.id ? { ...c, status: "merged" as const, mergedInto: e.into, decidedBy: `${w.by} ${w.at}` } : c)), assignments, updatedAt: w.at };
}
/** The open issues no category holds yet (or whose category was declined): what the next run files. */
export function unfiled(rec: CategoryRecord | null, open: Snap): number[] {
  const ok = rec ? live(rec) : new Map();
  return open.issues.map((i) => i.n).filter((n) => !ok.has(rec?.assignments[String(n)]?.category ?? "")).sort((a, b) => a - b);
}
/** Each active or proposed category with its (open) issues. */
export function counts(rec: CategoryRecord, open?: Snap) {
  const isOpen = open ? new Set(open.issues.map((i) => i.n)) : rec.open ? new Set(rec.open) : null;
  return rec.categories.filter((c) => c.status === "active" || c.status === "proposed").map((c) => ({ ...c,
    issues: Object.entries(rec.assignments).filter(([n, a]) => a.category === c.id && (!isOpen || isOpen.has(Number(n)))).map(([n]) => Number(n)).sort((a, b) => a - b) }));
}
/** A read of the open issues, recorded on the existing record so the page's counts follow GitHub even when nothing is filed. */
export const withOpen = (rec: CategoryRecord, open: Snap): CategoryRecord => ({ ...rec, open: open.issues.map((i) => i.n) });
