import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The issue evaluation set (src/domain/issue-eval.ts, src/issue-eval-store.ts, scripts/issue-eval.ts): labels derived
// from what Studio records, a template to label and its import, and a scorer that replays stored triage reports through
// the live rules of src/domain/issue-triage.ts against the gold set. Neutral fixtures in a temporary data directory; no
// model, no GitHub, no live server.     bun tests/issue-eval.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { must, setGitHome } from "../src/git";
const T = await import("../src/domain/issue-triage");
const C = await import("../src/domain/issue-categories");
const E = await import("../src/domain/issue-eval");
const { IssueEvalStore, commitReader, privatePathProblem, readsOf } = await import("../src/issue-eval-store");
const { IssueTriageStore } = await import("../src/issue-triage-store");
const { IssueCategoriesStore } = await import("../src/issue-categories-store");
let pass = 0; const ok = (v: unknown, n: string, extra = "") => { assert.ok(v, `${n} ${extra}`); pass++; console.log("PASS " + n); };
const refuses = (f: () => unknown, n: string, re?: RegExp) => { let msg = ""; try { f(); } catch (e: any) { msg = String(e?.message ?? e); } ok(msg && (!re || re.test(msg)), n, msg); };
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-4;
const ROOT = resolve(import.meta.dir, "..");

// --- a project's code at one commit, and a batch of six issues two investigators reported on ---
const temp = checkedTempDir("issue-eval-test-"); setGitHome(join(temp, "git-home"));
const repo = join(temp, "source"), data = join(temp, "data"); mkdirSync(join(repo, "src"), { recursive: true }); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]);
writeFileSync(join(repo, "src/a.ts"), "export function alpha(x: number) {\n  return x + 1\n}\n");
writeFileSync(join(repo, "src/b.ts"), "export const beta = (s: string) => s.trim().length\n");
writeFileSync(join(repo, "big.txt"), "x".repeat(2_000_001));
must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]);
const commit = must(repo, ["rev-parse", "HEAD"]);
const at = "2026-10-28T10:00:00Z", project = "fixture";
const issues = [1, 2, 3, 4, 5, 6].map((n) => ({ n, title: `Issue ${n}`, body: `Body ${n}`, labels: [] as string[], author: "someone", association: "NONE", updatedAt: at, hash: `h${n}` }));
const snapshot = { schema: 1 as const, repository: "fixture/project", fetchedAt: at, issues, hash: "snap" };
const A = (o: any = {}) => ({ locus: [{ file: "src/a.ts", symbol: "alpha", lines: "1-3" }], tag: "t", state: "present", evidence: "export function alpha(x: number) {", repro: "call alpha", security: "no", links: [], ...o });
const B = { locus: [{ file: "src/b.ts", symbol: "beta", lines: "1" }], evidence: "export const beta = (s: string) => s.trim().length" };
const none = { locus: [], evidence: "", state: "not-code" };
// #1 agreed single; #2 #3 an agreed ordered set; #4 disagrees (state); #5 agreed not-code; #6 disagrees (fixed? / present)
const reportA = { commit, groups: [], related: [{ members: [2, 3], order: [2, 3], why: "same flow" }], alone: [1, 4, 5, 6],
  issues: [{ n: 1, ...A() }, { n: 2, ...A(B) }, { n: 3, ...A(B) }, { n: 4, ...A({ security: "yes" }) }, { n: 5, ...A({ ...B, state: "not-code", security: "yes" }) }, { n: 6, ...A({ state: "fixed?" }) }] };
const reportB = { ...reportA, issues: [{ n: 1, ...A() }, { n: 2, ...A(B) }, { n: 3, ...A(B) }, { n: 4, ...A({ ...none, state: "not-found" }) }, { n: 5, ...A({ ...B, state: "not-code", security: "yes" }) }, { n: 6, ...A() }] };
const read = commitReader(repo)(commit);

try {
  // --- the code is read from the repository at the report's commit, never from a checkout ---
  ok(read("src/a.ts")?.includes("return x + 1") && read("src") === null && read("missing.ts") === null, "the reader gives a commit's regular files and null for a folder or a missing file");
  ok(read("big.txt") === null, "a file over 2 MB is not read");
  const unknown = commitReader(repo); unknown("f".repeat(40))("src/a.ts");
  ok(unknown.missing.has("f".repeat(40)), "a commit the repository lacks is named, so the score can say its code checks failed");

  // --- the stored triage and categories the records hold ---
  let triage = T.triageRecord({ project, snapshot, a: T.parseReport(reportA), b: T.parseReport(reportB), read, by: "issue-triage R-tri", now: () => at });
  ok(triage.packages.map((p) => `${p.id}:${p.members.join(",")}`).join(" ") === "P-1:2,3 P-2:1" && triage.toHuman.length === 2 && JSON.stringify(triage.noCode?.map((x) => [x.state, x.issues])) === '[["not-code",[5]]]', "the fixture gives two packages, two items for a person and one agreed not-code issue", JSON.stringify([triage.packages.map((p) => p.members), triage.toHuman, triage.noCode]));
  triage = T.approvePackages(triage, ["P-1"], snapshot).record;
  triage = { ...triage, packages: triage.packages.map((p) => p.id === "P-2" ? { ...p, joins: [{ id: "X-1", issues: [1], by: "captain", at, wasApproved: false }] } : p.id === "P-1" ? { ...p, work: { "2": { proposal: "R-prop", at } } } : p) };
  let cats = C.applyBuild(null, { categories: [{ name: "Alpha", scope: "the alpha part", issues: [1, 2, 3] }, { name: "Beta", scope: "the beta part", issues: [5, 6] }], planned: [{ n: 4, why: "a roadmap item" }] },
    { project, repository: "fixture/project", run: "R-cat", model: "stub m", at, snapshot });
  cats = C.approveCategories(cats, ["C-1", "C-2"], { by: "captain", at });
  cats = C.editCategories(cats, { op: "move", n: 3, to: "C-2" }, { by: "captain", at });
  cats = C.editCategories(cats, { op: "unplan", n: 4 }, { by: "captain", at });
  new IssueTriageStore(data).write(triage); new IssueCategoriesStore(data).write(cats);
  // the runs Studio keeps: the triage batch (snapshot, both reports, the skill each investigator got), the categorizer's
  // report, and a package issue's proposal whose Task merged
  const run = (id: string, v: any, files: Record<string, unknown> = {}) => { const d = join(data, "runs", id); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "run.json"), JSON.stringify({ id, params: { project }, createdAt: at, nodes: {}, ...v })); for (const [f, x] of Object.entries(files)) writeFileSync(join(d, f), JSON.stringify(x)); };
  const seenAll = { "src/a.ts": [[1, 3]], "src/b.ts": [[1, 1]] };
  run("R-tri", { workflow: "issue-triage", status: "succeeded", nodes: { a: { data: { triageReads: seenAll } }, b: { data: { triageReads: seenAll } } }, steps: [{ node: "snapshot", roleSkill: null }, { node: "a", roleSkill: { sha256: "a".repeat(64) } }, { node: "b", roleSkill: { sha256: "a".repeat(64) } }] }, { "issue-snapshot.json": snapshot, "issue-report-a.json": reportA, "issue-report-b.json": reportB });
  run("R-cat", { workflow: "issue-categories", status: "succeeded", steps: [{ node: "categorize", roleSkill: { sha256: "b".repeat(64) } }, { node: "categorize", roleSkill: { sha256: "c".repeat(64) } }], nodes: { categorize: { data: { categoriesReport: { mode: "build", report: { categories: [{ name: "Alpha", issues: [1, 2, 3] }, { name: "Beta", issues: [5, 6] }], planned: [{ n: 4 }] } } } } } });
  run("R-prop", { workflow: "firstmate-proposal", status: "succeeded", ctx: { childRun: "R-child" } });
  run("R-child", { workflow: "code-firstmate", status: "succeeded", nodes: { done: { visits: 1 } } });
  run("R-other", { workflow: "issue-triage", status: "succeeded", params: { project: "elsewhere" } }, { "issue-snapshot.json": snapshot, "issue-report-a.json": reportA, "issue-report-b.json": reportB });
  const store = new IssueEvalStore(data);
  refuses(() => store.dir("../x"), "a project id that climbs out of the data directory is refused", /Invalid project id/);
  refuses(() => store.dir("a/b"), "a project id with a slash is refused", /Invalid project id/);
  const keyed = store.writeScore(project, "../../evil/../k", { x: 1 });
  ok(keyed.startsWith(join(store.dir(project), "scores") + "/") && !existsSync(join(data, "evil")), "a score key cannot place its file outside the scores folder", keyed);
  rmSync(keyed);

  // --- private data never enters the repository ---
  const fakeRoot = join(temp, "checkout"), elsewhere = join(temp, "elsewhere"); mkdirSync(join(fakeRoot, "data"), { recursive: true }); mkdirSync(join(fakeRoot, "docs"), { recursive: true }); mkdirSync(elsewhere, { recursive: true });
  symlinkSync(join(fakeRoot, "docs"), join(elsewhere, "into-checkout"));
  const ign = (rel: string) => rel === "data" || rel.startsWith("data/");
  ok(privatePathProblem(fakeRoot, join(elsewhere, "gold.json"), ign) === null, "a path outside the checkout may hold private data");
  ok(privatePathProblem(fakeRoot, join(fakeRoot, "data/issue-eval/p/gold.json"), ign) === null, "the checkout's ignored data directory may hold private data");
  ok(/not ignored/.test(privatePathProblem(fakeRoot, join(fakeRoot, "docs/gold.json"), ign) ?? ""), "a tracked path inside the checkout may not");
  ok(/not ignored/.test(privatePathProblem(fakeRoot, join(elsewhere, "into-checkout/gold.json"), ign) ?? ""), "nor one that reaches the checkout through a symbolic link");
  ok(/not ignored/.test(privatePathProblem(fakeRoot, join(fakeRoot, "..x/gold.json"), ign) ?? ""), "a folder whose name starts with two dots is still inside the checkout");
  ok(privatePathProblem(fakeRoot, join(temp, "checkout-sibling/gold.json"), ign) === null, "a sibling folder of the checkout is outside it");
  ok(!!privatePathProblem(fakeRoot, fakeRoot, () => true) && !!privatePathProblem(fakeRoot, join(fakeRoot, ".git/x"), () => true), "the checkout itself and its .git never may");

  // --- derived labels ---
  const derived = E.mineDerived({ triage, categories: cats, work: (p) => store.work(p), at });
  ok(derived["3"]?.category === "C-2" && derived["3"].source === "derived", "a captain's move is gold for the category");
  ok(derived["4"]?.notPlanned === true && derived["4"].category === undefined, "taking an issue off planned work is gold that it is not planned, with no category");
  ok(derived["1"]?.package === "P-2" && derived["5"] === undefined, "a package the captain joined a match to is gold for its members; a package nobody judged gives nothing");
  ok(derived["2"]?.package === "P-1" && derived["3"]?.package === "P-1", "an approved package is gold for its members");
  ok(derived["2"]?.state === "present" && derived["3"]?.state === undefined && derived["2"].from!.includes("work merged"), "an issue whose Task merged is gold that the problem was there");
  const recheck = { ...triage, packages: triage.packages.map((p) => p.id === "P-1" ? { ...p, kind: "recheck" as const } : p) };
  const dr = E.mineDerived({ triage: recheck, categories: null, work: (p) => store.work(p), at });
  ok(dr["2"]?.package === "P-1" && dr["2"].state === undefined, "a recheck package whose Task merged says nothing about the state");
  ok(store.work("R-prop") === "merged" && store.work("R-none") === "closed", "the store reads a Task's state as the workflow does");
  const merged = C.editCategories(C.approveCategories(C.applyBuild(null, { categories: [{ name: "X", scope: "x", issues: [1] }, { name: "Y", scope: "y", issues: [2] }] }, { project, repository: "r", run: "R", model: "m", at, snapshot }), ["C-1", "C-2"], { by: "c", at }), { op: "merge", id: "C-1", into: "C-2" }, { by: "c", at });
  ok(E.mineDerived({ triage: null, categories: merged, at })["1"] === undefined, "a merge is not a judgement of the issue: it gives no label");

  // --- the template: a stratified sample prefilled with the current answers ---
  const t = E.labelTemplate({ project, triage, categories: cats, gold: null, sample: 4, seed: "s", at });
  const strata = new Set(t.rows.map((r) => r.stratum));
  ok(t.rows.length === 4 && strata.size === 4, "a sample takes one issue of each stratum before a second of any", JSON.stringify([...strata]));
  ok([...strata].some((s) => s.endsWith("|agree")) && [...strata].some((s) => s.endsWith("|disagree")), "both agreed and disagreed issues are sampled");
  const answersOf = E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot, read }]).preds;
  const all = E.labelTemplate({ project, triage, categories: cats, gold: null, sample: 50, seed: "s", at, reports: answersOf });
  const r1 = all.rows.find((r) => r.n === 1)!, r4 = all.rows.find((r) => r.n === 4)!, r6 = all.rows.find((r) => r.n === 6)!;
  ok(all.rows.length === 6 && r1.gold.state === "present" && r1.gold.files?.[0] === "src/a.ts" && r1.gold.security === "no" && r1.reviewed === false, "an agreed row is prefilled with the current answer and is not reviewed");
  ok((r4.model as any).a.state === "present" && (r4.model as any).b.state === "not-found" && (r4.model as any).a.security === "yes" && (r4.model as any).b.security === "no", "each row shows both investigators' answers");
  ok(r4.gold.state === undefined && r4.gold.files === undefined && r4.gold.security === undefined && r6.gold.state === undefined && r6.gold.files === undefined && r6.gold.security === "no", "a field the investigators disagree on (state, and then its files; security answered apart) is left for the captain to decide", JSON.stringify([r4.gold, r6.gold]));
  // one investigator did not report #6: nothing about it is prefilled
  const bOnly = { ...reportB, alone: [1, 4, 5], issues: reportB.issues.filter((f) => f.n !== 6) };
  const lone = T.triageRecord({ project, snapshot, a: T.parseReport(reportA), b: T.parseReport(bOnly), read, by: "issue-triage R-lone", now: () => at });
  const r6lone = E.labelTemplate({ project, triage: lone, categories: null, gold: null, sample: 50, seed: "s", at }).rows.find((r) => r.n === 6)!;
  ok(JSON.stringify(r6lone.gold) === "{}" && (r6lone.model as any).diff.includes("missing"), "an issue only one investigator reported is left wholly for the captain", JSON.stringify(r6lone.gold));
  // within a stratum the seed's order decides: C-1|agree holds #1 #2, C-2|agree holds #3 #5
  const rk = (seed: string, n: number) => createHash("sha256").update(`${seed}\0${n}`).digest("hex");
  const first = (seed: string, ns: number[]) => [...ns].sort((x, y) => (rk(seed, x) < rk(seed, y) ? -1 : 1))[0];
  const seeds = ["s", "t", "u", "v", "w", "x", "y", "z"], picks = seeds.map((seed) => E.labelTemplate({ project, triage, categories: cats, gold: null, sample: 4, seed, at }).rows.map((r) => r.n));
  ok(seeds.every((seed, i) => picks[i].includes(first(seed, [1, 2])) && picks[i].includes(first(seed, [3, 5]))) && picks.some((p) => p.includes(2) || p.includes(5)), "within a stratum the seed's order picks the issue", JSON.stringify(picks));
  ok(JSON.stringify(E.labelTemplate({ project, triage, categories: cats, gold: null, sample: 3, seed: "s", at })) === JSON.stringify(E.labelTemplate({ project, triage, categories: cats, gold: null, sample: 3, seed: "s", at })), "the same seed gives the same sample");
  const labeledOne = { ...E.emptyGold(project, at), captain: { "1": { n: 1, state: "present" as const, source: "captain" as const, at } } };
  ok(!E.labelTemplate({ project, triage, categories: cats, gold: labeledOne, sample: 50, seed: "s", at }).rows.some((r) => r.n === 1), "an issue the captain labeled is not offered again");

  // --- the import: refused whole on any bad row ---
  const file = (rows: any[], o: any = {}) => ({ schema: 1, kind: "issue-eval-labels", project, rows, ...o });
  const parse = (raw: any) => E.parseLabels(raw, { project, triage, categories: cats, at });
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { state: "broken" } }])), "a state outside the skill's words is refused", /state "broken"/);
  refuses(() => parse(file([{ n: 99, reviewed: true, gold: { state: "present" } }])), "an issue the records do not know is refused", /#99 is not an issue/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { category: "C-9" } }])), "a category that is not open is refused", /C-9/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { files: ["../etc/passwd"] } }])), "a path outside the checkout is refused", /files/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { security: "maybe" } }])), "a security answer other than yes or no is refused", /security/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: {} }])), "a reviewed row that labels nothing is refused", /labels nothing/);
  refuses(() => parse(file([], { project: "another" })), "a file for another project is refused", /another/);
  refuses(() => parse(file([], { schema: 2 })), "an unknown schema is refused", /schema/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { state: "present" } }, { n: 2, reviewed: true, gold: { state: "nope" } }])), "one bad row refuses the file, the good rows with it", /1 problem/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { state: "present" } }, { n: 1, reviewed: false, gold: {} }])), "an issue in the file twice is refused", /twice/);
  refuses(() => parse(file([{ n: 1, reviewed: true, gold: { state: "present", colour: "red" } }])), "an unknown field is refused", /unknown field colour/);
  refuses(() => parse(file([{ n: 4, reviewed: true, gold: { category: "PLANNED", notPlanned: true } }])), "planned and not planned at once is refused", /both planned and not planned/);
  ok(parse(file([{ n: 4, reviewed: true, gold: { notPlanned: true } }])).labels["4"].notPlanned === true && parse(file([{ n: 4, reviewed: true, gold: { category: "PLANNED" } }])).labels["4"].category === "PLANNED", "planned or not planned alone is imported");
  let four = C.approveCategories(C.applyBuild(null, { categories: ["W", "X", "Y", "Z"].map((name, i) => ({ name, scope: name, issues: [i + 1] })) }, { project, repository: "r", run: "R-4", model: "m", at, snapshot }), ["C-1", "C-2", "C-3"], { by: "c", at });
  four = C.editCategories(C.declineCategories(four, ["C-4"], { by: "c", at }), { op: "merge", id: "C-3", into: "C-2" }, { by: "c", at });
  const parse4 = (g: any) => E.parseLabels(file([{ n: 1, reviewed: true, gold: g }]), { project, triage, categories: four, at });
  refuses(() => parse4({ category: "C-4" }), "a declined category is refused", /C-4 is not an open category/);
  refuses(() => parse4({ category: "C-3" }), "a merged category is refused", /C-3 is not an open category/);
  ok(parse4({ category: "C-1" }).labels["1"].category === "C-1", "an active category is imported");
  const loose = parse(file([{ n: 1, reviewed: "true", gold: { state: "present" } }, { n: 2, reviewed: 1, gold: { state: "present" } }]));
  ok(Object.keys(loose.labels).length === 0 && loose.skipped === 2, "only reviewed: true imports a row");
  const good = parse(file([{ n: 1, reviewed: true, gold: { state: "present", files: ["./src/a.ts"] } }, { n: 2, reviewed: false, gold: { state: "present" } }]));
  ok(Object.keys(good.labels).join() === "1" && good.skipped === 1 && good.labels["1"].files![0] === "src/a.ts" && good.labels["1"].source === "captain", "reviewed rows are imported as the captain's, the rest skipped");
  ok(parse(file([{ n: 1, reviewed: true, gold: { state: "needs-info" } }])).labels["1"].state === "needs-info", "needs-info, the captain's ruling that an issue needs more from its reporter, is a state the gold set takes");
  // the disagreement court adds the captain's rulings to the gold set through the store, the derived labels untouched
  { const scratch = new IssueEvalStore(join(temp, "court-gold"));
    scratch.writeGold({ ...E.emptyGold(project, at), derived: { "3": { n: 3, package: "P-1", source: "derived", at } }, captain: { "2": { n: 2, state: "present", category: "C-1", security: "yes", source: "captain", at } } });
    scratch.addCaptain(project, { "1": { n: 1, state: "needs-info", source: "captain", at }, "2": { n: 2, state: "fixed?", files: ["src/b.ts"], package: "P-4", source: "captain", at } }, at);
    const g = scratch.gold(project)!;
    ok(g.captain["1"].state === "needs-info" && g.captain["2"].state === "fixed?" && g.captain["2"].package === "P-4" && g.captain["2"].category === "C-1" && g.captain["2"].security === "yes" && g.derived["3"].package === "P-1", "a court's labels are merged into the captain's field by field (an earlier category or security answer kept), the derived ones kept", JSON.stringify(g));
    // a later ruling replaces the answer (state, files, package) as a whole: no files or package left from the earlier one
    scratch.addCaptain(project, { "2": { n: 2, state: "needs-info", source: "captain", at } }, at);
    const g2 = scratch.gold(project)!.captain["2"];
    ok(g2.state === "needs-info" && g2.files === undefined && g2.package === undefined && g2.category === "C-1" && g2.security === "yes", "a later ruling replaces the earlier answer whole (state, files, package), keeping only the category, planned and security answers", JSON.stringify(g2));
    refuses(() => scratch.addCaptain(project, { "5": { n: 5, state: "present", source: "derived", at } as any }, at), "only the captain's labels are added that way", /captain/); }

  // --- scoring on a tiny hand-computed case ---
  const gold = { ...E.emptyGold(project, at), derived: E.mineDerived({ triage, categories: cats, work: (p) => store.work(p), at }), captain: Object.fromEntries([
    { n: 1, state: "present", files: ["src/a.ts"], security: "no", package: "K1", category: "C-2" }, { n: 2, state: "present", package: "K2", category: "C-1" }, { n: 3, state: "present", package: "K2" },
    { n: 4, state: "not-found", files: ["src/c.ts"], security: "no" }, { n: 5, state: "not-code", security: "yes", package: "K1" }, { n: 6, state: "fixed?" }].map((l) => [String(l.n), { ...l, source: "captain", at }])) } as any;
  const eff = E.effectiveGold(gold);
  ok(eff["3"].category === "C-2" && eff["3"].sources.category === "derived" && eff["3"].package === "K2" && eff["3"].sources.package === "captain", "the captain's fields win over derived ones, field by field");
  const replayed = E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot, read }]);
  const answers = E.categoryAnswers(cats, E.reportCategories(cats, store.categoryReports(project)));
  ok(answers.get(3) === "C-1" && answers.get(4) === "PLANNED" && answers.get(1) === "C-1", "where the captain changed a category, the categorizer's answer comes from its stored report");
  const s = E.score({ gold, replayed, categories: answers, follow: E.followMerged(cats) });
  // state: A misses #4, B misses #6; Studio answers only the packaged #1 #2 #3 #5, all right
  ok(near(s.state.a.accuracy, 5 / 6) && near(s.state.b.accuracy, 5 / 6) && s.state.studio.answered === 4 && near(s.state.studio.accuracy, 1) && near(s.state.studio.recall, 4 / 6), "state accuracy and recall per predictor", JSON.stringify(s.state.studio));
  ok(near(s.state.a.classes.present.precision, 3 / 4) && near(s.state.a.classes.present.recall, 1) && s.state.a.classes["not-found"].precision === null, "state precision and recall per class");
  // files: #1 right for both; #4 A names src/a.ts (wrong), B names none
  ok(near(s.files.a.hit, 0.5) && near(s.files.a.precision, 0.5) && near(s.files.a.recall, 0.5) && near(s.files.b.precision, 1) && near(s.files.b.recall, 0.5) && s.files.studio.answered === 1 && near(s.files.studio.coverage, 0.5), "location file overlap", JSON.stringify(s.files));
  // security: A says yes on #4 (wrong), so Studio's flag (either report) is wrong there too
  ok(near(s.security.a.accuracy, 2 / 3) && near(s.security.a.classes.yes.precision, 0.5) && near(s.security.a.classes.yes.recall, 1) && near(s.security.b.accuracy, 1) && near(s.security.studio.accuracy, 2 / 3), "security accuracy, and precision and recall on yes", JSON.stringify(s.security));
  // category: #1 C-2 vs C-1 wrong, #2 right, #3 C-2 vs C-1 wrong; planned: #4 was tagged planned, the captain says not
  ok(s.category.gold === 3 && near(s.category.accuracy, 1 / 3) && near(s.category.planned.precision, 0) && s.category.planned.recall === null, "category accuracy, and planned precision", JSON.stringify(s.category));
  // package: gold puts #1 with #5 and #2 with #3; Studio has #2 #3 together and #1, #5 apart
  ok(s.package.pairs.gold === 2 && s.package.pairs.predicted === 1 && near(s.package.pairs.precision, 1) && near(s.package.pairs.recall, 0.5) && near(s.package.exact, 0.5), "package membership as pairs, and exact sets", JSON.stringify(s.package));
  ok(s.bySource.captain.state.studio.gold === 6 && s.bySource.captain.category.gold === 2 && s.category.gold === 3 && near(s.bySource.captain.package.pairs.recall, 0.5) && s.bySource.derived.package.pairs.gold === 1 && near(s.bySource.derived.package.pairs.recall, 1) && s.bySource.derived.state.studio.gold === 1, "the captain's labels and the derived ones are scored apart", JSON.stringify(s.bySource.derived.package));
  ok(replayed.preds.get(5)?.noCode === "not-code" && replayed.preds.get(5)?.studio?.state === "not-code" && replayed.preds.get(5)?.human === false && s.human.noCode === 1, "an issue both find not-code is Studio's answer, not routed to a person", JSON.stringify(replayed.preds.get(5)));
  ok(s.human.investigated === 6 && s.human.routed === 2 && near(s.human.share, 2 / 6) && s.human.toHumanItems === 2, "the share routed to a person", JSON.stringify(s.human));
  ok(JSON.stringify(E.score({ gold, replayed: E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot, read }]), categories: answers, follow: E.followMerged(cats) })) === JSON.stringify(s), "the score is deterministic");
  // a gold category merged since: the gold follows the merge as the answers do
  let three = C.approveCategories(C.applyBuild(null, { categories: ["X", "Y", "Z"].map((name, i) => ({ name, scope: name, issues: [i + 1] })) }, { project, repository: "r", run: "R-3", model: "m", at, snapshot }), ["C-1", "C-2", "C-3"], { by: "c", at });
  three = C.editCategories(three, { op: "merge", id: "C-3", into: "C-1" }, { by: "c", at });
  const g3 = { ...E.emptyGold(project, at), captain: { "3": { n: 3, category: "C-3", source: "captain", at } } } as any, a3 = E.categoryAnswers(three, new Map([[3, "C-3"]]));
  ok(a3.get(3) === "C-1" && near(E.score({ gold: g3, replayed, categories: a3, follow: E.followMerged(three) }).category.accuracy, 1) && near(E.score({ gold: g3, replayed, categories: a3 }).category.accuracy, 0), "a gold category merged into another is scored as the one it was merged into");
  // an issue labeled security that both investigators answered "no" on: Studio flags it from the label
  const labeled = { ...snapshot, issues: snapshot.issues.map((i) => i.n === 1 ? { ...i, labels: ["security"] } : i) };
  const sl = E.score({ gold: { ...E.emptyGold(project, at), captain: { "1": { n: 1, security: "yes", source: "captain", at } } } as any, replayed: E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot: labeled, read }]), categories: answers });
  ok(near(sl.security.studio.accuracy, 1) && near(sl.security.a.accuracy, 0) && near(sl.security.b.accuracy, 0), "Studio's security flag counts the issue's security label", JSON.stringify(sl.security));
  // packages are replayed batch by batch: a gold pair answered by two batches is counted apart, not as a miss
  const only = (r: any, ns: number[]) => ({ ...r, related: [], groups: [], alone: ns, issues: r.issues.filter((f: any) => ns.includes(f.n)) });
  const split = E.replay([{ run: "R-x", at, a: only(reportA, [1]), b: only(reportB, [1]), snapshot, read }, { run: "R-y", at: "2026-10-29T00:00:00Z", a: only(reportA, [5]), b: only(reportB, [5]), snapshot, read }]);
  const sx = E.score({ gold: { ...E.emptyGold(project, at), captain: { "1": { n: 1, package: "K", source: "captain", at }, "5": { n: 5, package: "K", source: "captain", at } } } as any, replayed: split, categories: answers });
  ok(sx.package.pairs.crossBatch === 1 && sx.package.pairs.gold === 0 && sx.package.pairs.recall === null && sx.package.exactOf === 0, "a gold pair across batches is reported apart from the package metrics", JSON.stringify(sx.package));
  // an issue a later batch took again is counted once, by its latest answer
  const twice = E.score({ gold, replayed: E.replay([{ run: "R-1", at, a: reportA, b: reportB, snapshot, read, reads: { a: seenAll, b: seenAll } }, { run: "R-2", at: "2026-10-29T00:00:00Z", a: reportA, b: reportB, snapshot, read, reads: { a: seenAll, b: seenAll } }]), categories: answers });
  ok(twice.human.noCode === 1 && twice.human.investigated === 6 && twice.human.routed === 2, "no-code is counted on the latest answer per issue, not once per batch", JSON.stringify(twice.human));
  // old and new data side by side: the same metrics over only the batches with recorded reads
  const mixed = E.replay([{ run: "R-old", at, a: only(reportA, [1]), b: only(reportB, [1]), snapshot, read }, { run: "R-new", at: "2026-10-29T00:00:00Z", a: only(reportA, [5]), b: only(reportB, [5]), snapshot, read, reads: { a: seenAll, b: seenAll } }]);
  const sm = E.score({ gold: { ...E.emptyGold(project, at), captain: { "1": { n: 1, state: "present", source: "captain", at }, "5": { n: 5, state: "not-code", source: "captain", at } } } as any, replayed: mixed, categories: answers });
  ok(mixed.preds.get(1)?.withoutReads === true && mixed.preds.get(5)?.withoutReads === false && mixed.withoutReads === 1, "each answer says whether its batch had recorded reads");
  ok(sm.state.studio.gold === 2 && sm.withReads.issues === 1 && sm.withReads.gold === 1 && sm.withReads.state.studio.gold === 1 && near(sm.withReads.state.studio.accuracy, 1) && sm.withReads.human.investigated === 1, "a second metric set covers only the batches with recorded reads", JSON.stringify(sm.withReads.human));
  // one batch the rules cannot judge is skipped and named; the others are still scored
  const broken = E.replay([{ run: "R-broken", at, a: reportA, b: reportB, snapshot: { ...snapshot, issues: null } as any, read }, { run: "R-fine", at: "2026-10-29T00:00:00Z", a: reportA, b: reportB, snapshot, read }]);
  ok(broken.skipped.map((x) => x.run).join() === "R-broken" && broken.preds.size === 6 && broken.preds.get(1)?.run === "R-fine", "a batch the rules throw on is skipped and counted, the rest scored", JSON.stringify(broken.skipped));
  const bad = E.replay([{ run: "R-bad", at, a: { commit: "nope" }, b: reportB, snapshot, read }]);
  ok(bad.skipped.length === 1 && bad.preds.size === 0, "a stored report the current parser refuses is skipped and named");
  const later = E.replay([{ run: "R-2", at: "2026-10-29T00:00:00Z", a: { ...reportA, related: [], alone: [1, 2, 3, 4, 5, 6] }, b: { ...reportB, related: [], alone: [1, 2, 3, 4, 5, 6] }, snapshot, read }, { run: "R-tri", at, a: reportA, b: reportB, snapshot, read }]);
  ok(later.preds.get(2)?.run === "R-2" && later.preds.get(2)?.package !== later.preds.get(3)?.package, "an issue investigated twice is answered by its latest batch");

  // --- the scorer runs the live rules, never a copy ---
  ok(E.RULES.compareReports === T.compareReports && E.RULES.verifyReport === T.verifyReport && E.RULES.proposePackages === T.proposePackages && E.RULES.parseReport === T.parseReport, "the scorer's rules are the functions of src/domain/issue-triage.ts");
  const src = readFileSync(join(ROOT, "src/domain/issue-eval.ts"), "utf8");
  ok(!/function\s+(compareReports|verifyReport|proposePackages|parseReport)\b/.test(src) && /from '\.\/issue-triage'/.test(src), "src/domain/issue-eval.ts defines none of the rules it scores");
  const strict = E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot, read }], { ...E.RULES, proposePackages: () => ({ packages: [], toHuman: [] }) });
  ok(E.score({ gold, replayed: strict, categories: answers }).human.share === 1, "a changed packaging rule changes the score (the human-routed share)");
  // what fs_read showed each investigator, where the run recorded it: the live check uses it
  const withReads = (reads: any) => E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot, read, reads }]);
  const full = withReads({ a: seenAll, b: seenAll }), blind = withReads({ a: {}, b: {} }), old = withReads(undefined);
  ok(full.packages === 2 && full.withoutReads === 0 && blind.packages === 0 && [1, 2, 3].every((n) => blind.preds.get(n)?.human), "recorded reads are checked: a quote nobody was shown packages nothing", JSON.stringify([full.packages, blind.packages]));
  ok(old.packages === 2 && old.withoutReads === 1, "a report from before reads were recorded is replayed without that one check, and counted");
  ok(JSON.stringify(readsOf(seenAll)) === JSON.stringify(seenAll) && [{ "src/a.ts": [[3, 1]] }, { "src/a.ts": "1-3" }, { "src/a.ts": [[0, 2]] }, { "src/a.ts": [[1, 2, 3]] }, [[1, 2]], "x", null].every((v) => readsOf(v) === undefined), "recorded reads are taken only as {file: [[start, end]]}");
  const stored = store.triageBatches(project, () => read).batches[0];
  ok(JSON.stringify(stored.reads?.a) === JSON.stringify(seenAll) && E.replay([stored]).withoutReads === 0, "the store gives each investigator's recorded reads to the replay");
  run("R-malformed", { workflow: "issue-triage", status: "succeeded", params: { project: "malformed" }, nodes: { a: { data: { triageReads: { "src/a.ts": "everything" } } }, b: { data: { triageReads: seenAll } } } }, { "issue-snapshot.json": snapshot, "issue-report-a.json": reportA, "issue-report-b.json": reportB });
  const mal = store.triageBatches("malformed", () => read).batches[0], malReplay = E.replay([mal]);
  ok(mal.reads?.a === undefined && mal.reads?.b !== undefined && malReplay.withoutReads === 1 && malReplay.skipped.length === 0 && malReplay.preds.size === 6, "malformed recorded reads make that batch one without reads, not a crash");
  const noCode = E.replay([{ run: "R-tri", at, a: reportA, b: reportB, snapshot, read: () => null }]);
  ok([1, 2, 3].every((n) => noCode.preds.get(n)?.human), "without the code every quoted line fails the live check, so nothing with a location is packaged");

  // --- the script: mine, label, import, score; everything under the data directory ---
  const cli = (...args: string[]) => { const r = Bun.spawnSync([process.execPath, join(ROOT, "scripts/issue-eval.ts"), ...args, "--data", data], { cwd: temp, stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
  const inside = join(ROOT, "docs", "issue-eval-test-data"), di = Bun.spawnSync([process.execPath, join(ROOT, "scripts/issue-eval.ts"), "mine", project, "--data", inside], { cwd: temp, stdout: "pipe", stderr: "pipe" });
  ok(di.exitCode === 1 && !existsSync(inside) && /inside the repository/.test(di.stderr.toString()), "a data directory inside the checkout that git tracks is refused before anything is written", di.stderr.toString());
  const bp = cli("mine", "../x");
  ok(bp.code === 1 && /Invalid project id/.test(bp.out) && !/\n\s+at /.test(bp.out), "an invalid project id is a message, not a stack trace", bp.out);
  const m = cli("mine", project);
  ok(m.code === 0 && /4 derived labels/.test(m.out) && store.gold(project)?.schema === 1, "mine writes the derived labels to the project's gold set", m.out);
  const inRepo = join(ROOT, "issue-eval-labels-test.json"), l1 = cli("label", project, "--sample", "3", "--out", inRepo);
  ok(l1.code === 1 && !existsSync(inRepo) && /inside the repository/.test(l1.out), "a template is never written into the repository", l1.out);
  const l2 = cli("label", project, "--sample", "50");
  const tf = readdirSync(store.dir(project)).find((f) => f.startsWith("labels-"));
  ok(l2.code === 0 && tf, "label writes the template under the data directory", l2.out);
  const tpl = JSON.parse(readFileSync(join(store.dir(project), tf!), "utf8"));
  tpl.rows = tpl.rows.map((r: any) => r.n === 6 ? { ...r, reviewed: true, gold: { ...r.gold, state: "fixed?" } } : r);
  writeFileSync(join(temp, "labeled.json"), JSON.stringify(tpl));
  writeFileSync(join(temp, "broken.json"), JSON.stringify({ ...tpl, rows: [{ ...tpl.rows[0], reviewed: true, gold: { state: "unknown" } }] }));
  const ib = cli("import", project, join(temp, "broken.json"));
  ok(ib.code === 1 && Object.keys(store.gold(project)!.captain).length === 0, "a refused import writes nothing", ib.out);
  const im = cli("import", project, join(temp, "labeled.json"));
  ok(im.code === 0 && store.gold(project)!.captain["6"]?.state === "fixed?" && /1 labels imported/.test(im.out), "import adds the reviewed rows as the captain's labels", im.out);
  const sc = cli("score", project, "--repo", repo);
  const written = store.scores(project);
  ok(sc.code === 0 && written.length === 1 && written[0].replay.batches === 1 && written[0].skills.recorded.join() === ["a".repeat(64), "c".repeat(64)].join(), "score replays the project's own batch only and records the skills that wrote the reports (each step's latest turn)", sc.out);
  ok(/^[a-f0-9]{12}-[a-f0-9]{12}/.test(written[0].key) && written[0].code.commit.length === 40 && written[0].state.studio.gold >= 1, "the score is keyed by the reports' skills and the code commit", written[0].key);
  ok(cli("score", project, "--repo", repo).code === 0 && store.scores(project).length === 1, "the same gold, reports and code score under the same key");
  const tpl2 = JSON.parse(readFileSync(join(temp, "labeled.json"), "utf8")); tpl2.rows = tpl2.rows.map((r: any) => r.n === 5 ? { ...r, reviewed: true, gold: { state: "not-code" } } : { ...r, reviewed: false });
  writeFileSync(join(temp, "labeled2.json"), JSON.stringify(tpl2));
  const sc2 = cli("import", project, join(temp, "labeled2.json")).code === 0 && cli("score", project, "--repo", repo), keys = store.scores(project).map((x: any) => x.key);
  ok(sc2 && sc2.code === 0 && keys.length === 2 && keys[0].split("-g")[0] === keys[1].split("-g")[0] && keys[0] !== keys[1], "a grown gold set scores under a new key, keeping the earlier score", JSON.stringify(keys));
  const nr = cli("score", project, "--no-write");
  ok(nr.code === 0 && /no repository/.test(nr.out) && store.scores(project).length === 2, "without a repository the score warns that every code check fails, and --no-write writes nothing", nr.out);
} finally {
  rmSync(join(ROOT, "docs", "issue-eval-test-data"), { recursive: true, force: true });
  rmSync(temp, { recursive: true, force: true });
}
console.log(`\n${pass} passed`);
