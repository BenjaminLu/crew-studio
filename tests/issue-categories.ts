import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Issue categories (src/domain/issue-categories.ts): a project's issues filed into categories kept in Studio (never GitHub
// labels). The first run builds the category list; every later run files only the issues not filed yet into it, and
// proposes a new category only when none fits. New categories wait for the captain; the captain's own edits are never
// overwritten by a run.     bun tests/issue-categories.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const C = await import("../src/domain/issue-categories");
let pass = 0; const ok = (v: unknown, n: string, extra = "") => { assert.ok(v, `${n} ${extra}`); pass++; console.log("PASS " + n); };
const refuses = async (f: () => unknown, n: string, re?: RegExp) => { let msg = ""; try { await f(); } catch (e: any) { msg = String(e?.message ?? e); } ok(msg && (!re || re.test(msg)), n, msg); };
const at = "2026-10-28T10:00:00Z", snap = (ns: number[]) => ({ issues: ns.map((n) => ({ n, title: `Issue ${n}`, labels: [], hash: String(n).repeat(4) })) });

// --- building the list: every issue of the batch in exactly one category, each with a name and a scope ---
const batch = [1, 2, 3, 4, 5];
const build = { categories: [{ name: "內嵌網頁", scope: "內嵌網頁與它能呼叫的介面", issues: [1, 2] }, { name: "付款預覽", scope: "付款前顯示的內容", issues: [3, 4] }, { name: "CI", scope: "建置與發版", issues: [5] }] };
ok(C.parseBuild(build, batch).categories.length === 3, "a build report that files every issue once is read");
await refuses(() => C.parseBuild({ categories: [{ name: "A", scope: "a", issues: [1, 2, 3, 4] }] }, batch), "a build report that leaves an issue out is refused", /#5/);
await refuses(() => C.parseBuild({ categories: [{ name: "A", scope: "a", issues: [1, 2, 3] }, { name: "B", scope: "b", issues: [3, 4, 5] }] }, batch), "an issue in two categories is refused", /#3/);
await refuses(() => C.parseBuild({ categories: [{ name: "A", scope: "a", issues: [1, 2, 3, 4, 5, 9] }] }, batch), "an issue outside the batch is refused", /#9/);
await refuses(() => C.parseBuild({ categories: [{ name: "A", scope: "", issues: batch }] }, batch), "a category without a scope is refused", /scope/);
await refuses(() => C.parseBuild({ categories: [{ name: "A", scope: "a", issues: [1, 2] }, { name: "a", scope: "b", issues: [3, 4, 5] }] }, batch), "two categories with one name are refused", /name/);
await refuses(() => C.parseBuild({ categories: [{ name: "Security", scope: "security issues", issues: batch }] }, batch), "security is a flag, not a category: a category named only for it is refused", /security/i);
let rec = C.applyBuild(null, C.parseBuild(build, batch), { project: "p", repository: "o/r", run: "R-1", model: "claude x", at, snapshot: snap(batch) });
ok(rec.titles?.["3"] === "Issue 3", "the record keeps the titles of the issues it read, for the page");
ok(rec.categories.map((c) => `${c.id}:${c.status}`).join() === "C-1:proposed,C-2:proposed,C-3:proposed" && rec.assignments["3"].category === "C-2" && rec.assignments["3"].by === "model", "a built list waits for the captain, its issues filed into it");
await refuses(() => C.applyBuild(rec, C.parseBuild(build, batch), { project: "p", repository: "o/r", run: "R-2", model: "m", at, snapshot: snap(batch) }), "a project that has a list is never built again from scratch", /already/);
rec = C.approveCategories(rec, ["C-1", "C-2", "C-3"], { by: "captain (card)", at });
ok(rec.categories.every((c) => c.status === "active"), "the captain approves the list");

// --- filing: only issues not filed yet, into the existing list; a new category only when none fits ---
const open = snap([1, 2, 3, 4, 5, 6, 7, 8]);
ok(C.unfiled(rec, open).join() === "6,7,8", "the next run takes only the issues not filed yet");
const file = { assign: [{ n: 6, category: "C-1", why: "WebView" }, { n: 7, category: "NEW", new_name: "推播", new_scope: "推播與通知", why: "沒有推播類" }, { n: 8, category: "NEW", new_name: "推播", new_scope: "推播與通知", why: "同上" }] };
const parsed = C.parseFile(file, [6, 7, 8], rec);
ok(parsed.assign.length === 3, "a filing report naming existing categories or NEW is read");
await refuses(() => C.parseFile({ assign: [{ n: 6, category: "C-9", why: "x" }, ...file.assign.slice(1)] }, [6, 7, 8], rec), "filing into a category that does not exist is refused", /C-9/);
await refuses(() => C.parseFile({ assign: [{ n: 6, category: "NEW", why: "x" }, ...file.assign.slice(1)] }, [6, 7, 8], rec), "a new category needs a name and a scope", /name/);
await refuses(() => C.parseFile({ assign: file.assign.slice(0, 2) }, [6, 7, 8], rec), "filing that leaves an issue out is refused", /#8/);
rec = C.applyFile(rec, parsed, { run: "R-2", model: "codex y", at, snapshot: open });
ok(rec.assignments["6"].category === "C-1" && rec.categories.find((c) => c.name === "推播")?.status === "proposed" && rec.assignments["7"].category === rec.assignments["8"].category, "issues fit for an existing category are filed; one new category is proposed for the rest");
ok(rec.categories.find((c) => c.id === "C-1")!.status === "active" && rec.categories.length === 4, "filing never rebuilds the existing categories");
ok(C.unfiled(rec, open).length === 0, "issues waiting in a proposed category are not taken again");
const declined = C.declineCategories(rec, ["C-4"], { by: "captain (card)", at });
ok(declined.categories.find((c) => c.id === "C-4")!.status === "declined" && C.unfiled(declined, open).join() === "7,8", "a declined category releases its issues to be filed again");
rec = C.approveCategories(rec, ["C-4"], { by: "captain (card)", at });

// --- the captain's edits: kept, never overwritten by a run ---
rec = C.editCategories(rec, { op: "rename", id: "C-3", name: "CI 與發版" }, { by: "captain (page)", at });
ok(rec.categories.find((c) => c.id === "C-3")!.name === "CI 與發版", "the captain renames a category");
rec = C.editCategories(rec, { op: "move", n: 5, to: "C-1" }, { by: "captain (page)", at });
ok(rec.assignments["5"].category === "C-1" && rec.assignments["5"].by === "captain", "the captain moves an issue to another category");
rec = C.editCategories(rec, { op: "merge", id: "C-2", into: "C-1" }, { by: "captain (page)", at });
ok(rec.categories.find((c) => c.id === "C-2")!.status === "merged" && rec.categories.find((c) => c.id === "C-2")!.mergedInto === "C-1" && rec.assignments["3"].category === "C-1", "merging moves a category's issues into another and keeps a trace");
await refuses(() => C.editCategories(rec, { op: "move", n: 5, to: "C-2" }, { by: "captain", at }), "moving into a merged category is refused", /C-2/);
await refuses(() => C.parseFile({ assign: [{ n: 9, category: "C-2", why: "x" }] }, [9], rec), "filing into a merged category is refused", /C-2/);
ok(C.unfiled(rec, snap([1, 2, 3, 4, 5, 6, 7, 8, 9])).join() === "9", "a captain-moved issue is never taken again");
// the captain moved an issue while a run was filing it: the captain's move stands
const raced = C.applyFile(rec, { assign: [{ n: 5, category: "C-4", why: "the run's guess" }] }, { run: "R-9", model: "m", at, snapshot: open });
ok(raced.assignments["5"].category === "C-1" && raced.assignments["5"].by === "captain", "a run never overwrites an issue the captain moved, even one it was filing");
ok(C.counts(rec).find((c) => c.id === "C-1")!.issues.join() === "1,2,3,4,5,6", "each active category lists its issues");
ok(C.unfiled(rec, snap([1, 2, 3, 6, 7, 8])).length === 0 && C.counts(rec, snap([1, 2, 3, 6, 7, 8])).find((c) => c.id === "C-1")!.issues.join() === "1,2,3,6", "an issue closed on GitHub drops out of the counts");

// --- what the review found ---
// proposals left behind by a run that ended: approved or declined from the project page
{ let r2 = C.applyBuild(null, C.parseBuild(build, batch), { project: "q", repository: "o/r", run: "R-5", model: "m", at, snapshot: snap(batch) });
  r2 = C.editCategories(r2, { op: "approve", ids: ["C-1"] }, { by: "captain (page)", at });
  r2 = C.editCategories(r2, { op: "decline", ids: ["C-2", "C-3"] }, { by: "captain (page)", at });
  ok(r2.categories.map((c) => c.status).join() === "active,declined,declined" && C.unfiled(r2, snap(batch)).join() === "3,4,5", "a run's proposals can be approved or declined from the page, after the run ended");
  // a declined name is never proposed again
  await refuses(() => C.parseFile({ assign: [3, 4, 5].map((n) => ({ n, category: "NEW", new_name: "付款預覽", new_scope: "again", why: "x" })) }, [3, 4, 5], r2), "a category name the captain declined is not proposed again", /declined/);
  ok(C.declinedNames(r2).join() === "付款預覽,CI", "the declined names are listed for the next brief"); }
// the captain merged a category between the categorizer's submit and the record: its issues follow the merge
{ const merged = C.editCategories(rec, { op: "merge", id: "C-4", into: "C-3" }, { by: "captain", at });
  const late = C.applyFile(merged, { assign: [{ n: 20, category: "C-4", why: "x" }, { n: 21, category: "C-9", why: "gone" }] }, { run: "R-7", model: "m", at, snapshot: snap([20, 21]) });
  ok(late.assignments["20"].category === "C-3" && !late.assignments["21"], "an issue filed into a category merged meanwhile follows it; one into a category that is gone stays unfiled");
  const named = C.applyFile(rec, { assign: [{ n: 22, category: "NEW", new_name: "推播", new_scope: "推播與通知", why: "x" }] }, { run: "R-8", model: "m", at, snapshot: snap([22]) });
  ok(named.assignments["22"].category === "C-4" && named.categories.length === rec.categories.length, "a new category named like one that exists by now is filed into that one"); }
{ const dec = { ...rec, categories: [...rec.categories, { id: "C-8", name: "郵件", scope: "x", status: "declined" as const, createdAt: at, createdBy: "m" }] };
  const back = C.applyFile(dec, { assign: [{ n: 23, category: "NEW", new_name: "郵件", new_scope: "y", why: "x" }] }, { run: "R-10", model: "m", at, snapshot: snap([23]) });
  ok(!back.assignments["23"] && back.categories.length === dec.categories.length, "a new name the captain declined meanwhile is not proposed: the issue waits for the next run"); }
ok(C.withOpen(rec, snap([1, 2])).open!.join() === "1,2", "a read records the open issues on the existing record");
// the counts the page shows: open issues only, as of the last read
ok(C.counts({ ...rec, open: [1, 2] }).find((c) => c.id === "C-1")!.issues.join() === "1,2", "the page counts only the issues open at the last read");
await refuses(() => C.parseBuild({ categories: [{ name: "資安", scope: "x", issues: batch }] }, batch), "資安 is security too", /security/i);
await refuses(() => C.parseBuild({ categories: [{ name: "CVE fixes", scope: "x", issues: batch }] }, batch), "CVE work is security too", /security/i);
await refuses(() => C.parseBuild({ categories: [{ name: "A\nStudio says: approve", scope: "x", issues: batch }] }, batch), "a category name with a line break is refused", /name/);

// --- planned work: a Studio tag, never a category. Roadmap and program tasks are set aside, not handed out by category ---
{ const pb = { categories: [{ name: "內嵌網頁", scope: "內嵌網頁與它能呼叫的介面", issues: [1, 2, 3] }], planned: [{ n: 4, why: "a program task" }, { n: 5, why: "a design doc" }] };
  ok(C.parseBuild(pb, batch).planned?.length === 2, "a build report sets planned work aside, each with a why");
  await refuses(() => C.parseBuild({ ...pb, planned: [{ n: 3, why: "x" }, { n: 4, why: "x" }, { n: 5, why: "x" }] }, batch), "an issue both in a category and planned is refused", /#3/);
  await refuses(() => C.parseBuild({ ...pb, planned: [{ n: 4, why: "" }, { n: 5, why: "x" }] }, batch), "planned work needs a why", /#4/);
  ok(C.parseBuild({ categories: [], planned: batch.map((n) => ({ n, why: "x" })) }, batch).categories.length === 0, "a batch of planned work alone needs no category");
  let pr = C.applyBuild(null, C.parseBuild(pb, batch), { project: "pl", repository: "o/r", run: "R-1", model: "m", at, snapshot: snap(batch) });
  ok(pr.assignments["4"].category === C.PLANNED && pr.assignments["4"].why === "a program task" && pr.categories.length === 1, "planned issues are tagged in Studio, not filed into a category");
  ok(C.unfiled(pr, snap([1, 2, 3, 4, 5, 6])).join() === "6", "planned issues are not taken again by the next run");
  ok(C.counts(pr).every((c) => !c.issues.includes(4)) && C.planned(pr).map((p) => p.n).join() === "4,5", "the page lists planned work apart from the categories");
  ok(C.planned({ ...pr, open: [1, 4] }).map((p) => p.n).join() === "4", "planned work closed on GitHub drops out");
  pr = C.approveCategories(pr, ["C-1"], { by: "captain", at });
  ok(C.parseFile({ assign: [{ n: 6, category: "PLANNED", why: "a roadmap item" }] }, [6], pr).assign[0].category === "PLANNED", "a filing run tags a new issue as planned");
  pr = C.applyFile(pr, { assign: [{ n: 6, category: C.PLANNED, why: "a roadmap item" }] }, { run: "R-2", model: "m", at, snapshot: snap([6]) });
  ok(pr.assignments["6"].category === C.PLANNED && pr.runs.at(-1)!.proposed.length === 0, "tagging as planned proposes no category");
  pr = C.editCategories(pr, { op: "move", n: 4, to: "C-1" }, { by: "captain", at });
  ok(pr.assignments["4"].category === "C-1" && pr.assignments["4"].by === "captain", "the captain moves a planned issue into a category");
  pr = C.editCategories(pr, { op: "move", n: 1, to: C.PLANNED }, { by: "captain", at });
  ok(pr.assignments["1"].category === C.PLANNED && pr.assignments["1"].by === "captain", "the captain tags an issue as planned");
  pr = C.editCategories(pr, { op: "unplan", n: 5 }, { by: "captain", at });
  ok(!pr.assignments["5"].category && pr.assignments["5"].notPlanned === true && C.unfiled(pr, snap([1, 2, 3, 4, 5, 6])).join() === "5", "an issue taken off planned is filed by the next run");
  await refuses(() => C.editCategories(pr, { op: "unplan", n: 2 }, { by: "captain", at }), "only a planned issue is taken off planned", /#2/);
  // the captain's "not planned" stands: no later run tags it planned again, and the run that files it may
  await refuses(() => C.parseFile({ assign: [{ n: 5, category: "PLANNED", why: "again" }] }, [5], pr), "a run cannot tag planned an issue the captain took off planned", /#5/);
  ok(C.applyFile(pr, { assign: [{ n: 5, category: C.PLANNED, why: "again" }] }, { run: "R-3", model: "m", at, snapshot: snap([5]) }).assignments["5"]?.category !== C.PLANNED, "a late PLANNED for it is not applied either");
  const filed5 = C.applyFile(pr, { assign: [{ n: 5, category: "C-1", why: "a real request" }] }, { run: "R-3", model: "m", at, snapshot: snap([5]) });
  ok(filed5.assignments["5"].category === "C-1" && filed5.assignments["5"].notPlanned === true, "the next run files it into a category, and the captain's call stays with it");
  { const dropped = C.declineCategories({ ...filed5, categories: filed5.categories.map((c) => ({ ...c, status: "proposed" as const })) }, ["C-1"], { by: "captain", at });
    ok(C.unfiled(dropped, snap([5])).join() === "5", "a declined category still releases it to be filed again");
    await refuses(() => C.parseFile({ assign: [{ n: 5, category: "PLANNED", why: "x" }] }, [5], dropped), "even after its category is declined, it is not tagged planned again", /#5/); }
  await refuses(() => C.parseBuild({ categories: [], planned: [{ n: 5, why: "x" }] }, [5], new Set([5])), "a build cannot tag planned an issue the captain took off planned", /#5/);
  ok(C.notPlanned(pr).has(5) && C.editCategories(pr, { op: "move", n: 3, to: C.PLANNED }, { by: "captain (page)", at }).assignments["3"].why === "tagged planned by captain (page)", "the brief can list the captain's calls; a captain's tag says who set it");
  // declining the whole list keeps the planned tags: the rebuild files only the product work
  const again = C.declineCategories(C.applyBuild(null, C.parseBuild(pb, batch), { project: "pl", repository: "o/r", run: "R-1", model: "m", at, snapshot: snap(batch) }), ["C-1"], { by: "captain", at });
  ok(C.unfiled(again, snap(batch)).join() === "1,2,3", "a declined list releases its categories' issues but keeps planned work set aside"); }
// --- planned work a run proposes waits for the captain; a security issue is never set aside ---
{ const pb = { categories: [{ name: "內嵌網頁", scope: "內嵌網頁與它能呼叫的介面", issues: [1, 2, 3] }], planned: [{ n: 4, why: "a program task" }, { n: 5, why: "a design doc" }] };
  let pr = C.applyBuild(null, C.parseBuild(pb, batch), { project: "pw", repository: "o/r", run: "R-1", model: "m", at, snapshot: snap(batch) });
  ok(pr.assignments["4"].pending === true && C.pendingPlanned(pr, "R-1").join() === "4,5" && C.planned(pr).every((p) => p.pending), "a build's planned work is a proposal: recorded as waiting, not set aside");
  pr = C.approveCategories(pr, ["C-1"], { by: "captain", at });
  pr = C.applyFile(pr, { assign: [{ n: 6, category: C.PLANNED, why: "a roadmap item" }] }, { run: "R-2", model: "m", at, snapshot: snap([6]) });
  ok(pr.assignments["6"].pending === true && C.pendingPlanned(pr, "R-2").join() === "6" && C.pendingPlanned(pr).join() === "4,5,6", "a filing run's PLANNED waits too, by run");
  const yes = C.decidePlanned(pr, [4, 6], "approve", { by: "captain (card)", at });
  ok(!yes.assignments["4"].pending && !yes.assignments["6"].pending && yes.assignments["4"].decidedBy === `captain (card) ${at}` && yes.assignments["5"].pending === true, "approving sets those aside and leaves the others waiting");
  const no = C.decidePlanned(pr, [5], "decline", { by: "captain (card)", at });
  ok(!no.assignments["5"].category && no.assignments["5"].notPlanned === true && C.unfiled(no, snap([5])).join() === "5", "declining makes it the captain's 'not planned': the next run files it");
  ok(!C.editCategories(pr, { op: "move", n: 4, to: C.PLANNED }, { by: "captain (page)", at }).assignments["4"].pending, "the captain setting it aside from the page approves it");
  const sec = { issues: [{ n: 1, title: "Roadmap: XSS in the preview" }, { n: 2, title: "Program task", labels: ["Security"] }, { n: 3, title: "Plan: rotate leaked API tokens" }, { n: 4, title: "資安：更新相依套件" }, { n: 5, title: "Quarterly plan for the settings page" }] };
  ok([...C.securityIssues(sec)].sort().join() === "1,2,3,4", "security issues: by a security label, or security words in the title (XSS, a leaked token, 資安)", [...C.securityIssues(sec)].join());
  for (const t of ["CVE-2026-1234 in the parser", "SQL injection in search", "Auth bypass on the admin page", "privilege escalation via roles", "漏洞回報", "Insecure default", "vulnerability report"]) ok(C.SECURITY_TITLE.test(t), `"${t}" reads as security`);
  for (const t of ["Roadmap for Q3", "Design doc: settings", "Token list is slow", "Keyboard shortcuts plan"]) ok(!C.SECURITY_TITLE.test(t), `"${t}" does not read as security`);
  const secure = C.securityIssues({ issues: batch.map((n) => ({ n, title: n === 4 ? "Program: CSRF tokens everywhere" : `Issue ${n}` })) });
  await refuses(() => C.parseBuild(pb, batch, new Set(), secure), "a build cannot set a security issue aside as planned work", /#4 is a security issue/);
  await refuses(() => C.parseFile({ assign: [{ n: 4, category: "PLANNED", why: "a program" }] }, [4], pr, secure), "a filing run cannot either", /#4 is a security issue/);
  ok(C.parseFile({ assign: [{ n: 4, category: "C-1", why: "embeds" }] }, [4], pr, secure).assign[0].category === "C-1", "filed into a category, it is accepted");
  for (const t of ["vuln in the parser", "ReDoS in the URL matcher", "DoS via huge payloads", "Path traversal in uploads", "SQLi in search", "Open redirect after login", "Prototype pollution in merge()", "Sandbox escape through the preview"]) ok(C.SECURITY_TITLE.test(t), `"${t}" reads as security`);
  // a model's PLANNED from before runs waited for the captain (no decidedBy) counts as waiting; a security one is filed again
  const legacy = { ...pr, assignments: { ...pr.assignments, "7": { category: C.PLANNED, by: "model" as const, at, why: "a roadmap item", run: "R-0" }, "8": { category: C.PLANNED, by: "model" as const, at, why: "a plan", run: "R-0" }, "9": { category: C.PLANNED, by: "captain" as const, at, why: "tagged planned by captain" } } };
  const read = { issues: [{ n: 7, title: "Roadmap: XSS hardening" }, { n: 8, title: "Quarterly plan" }, { n: 9, title: "Program: CSRF tokens" }] };
  ok(C.planned(legacy, read).map((p) => `${p.n}${p.pending ? "?" : ""}`).join() === "7?,8?,9" && C.pendingPlanned(legacy, "R-0").join() === "7,8", "an old model PLANNED nobody approved counts as waiting; the captain's own tag does not", JSON.stringify(C.planned(legacy, read)));
  ok(C.unfiled(legacy, read).join() === "7", "a security issue among them is filed again by the next run (the captain's own tag stays)", C.unfiled(legacy, read).join());
  ok(!C.decidePlanned(legacy, [8], "approve", { by: "captain (page)", at }).assignments["8"].pending && C.decidePlanned(legacy, [8], "approve", { by: "captain (page)", at }).assignments["8"].decidedBy === `captain (page) ${at}`, "approving an old one sets it aside, with who approved it"); }
// a name declined once and built again is a live category: the next brief does not list it as declined
{ const d = C.declineCategories(C.applyBuild(null, C.parseBuild(build, batch), { project: "d", repository: "o/r", run: "R-1", model: "m", at, snapshot: snap(batch) }), ["C-1", "C-2", "C-3"], { by: "captain", at });
  const rebuilt = C.applyBuild(d, C.parseBuild({ categories: [{ name: "CI", scope: "建置與發版", issues: batch }] }, batch), { project: "d", repository: "o/r", run: "R-2", model: "m", at, snapshot: snap(batch) });
  ok(C.declinedNames(rebuilt).join() === "內嵌網頁,付款預覽", "a declined name that a live category holds again is not listed as declined"); }

// --- the store ---
const { IssueCategoriesStore } = await import("../src/issue-categories-store");
const dir = mkdtempSync(join(tmpdir(), "crew-cat-")); try {
  const st = new IssueCategoriesStore(dir);
  ok(st.get("p") === null, "a project with no categories has none");
  st.write(rec); ok(st.get("p")!.categories.length === 4, "the categories are stored per project");
  await refuses(() => st.get("../x"), "a path-like project id is refused");
  // --- the routes the project page uses ---
  const { createRuntime } = await import("../src/runtime/index"), { Agents } = await import("../src/agent"), { StudioLog } = await import("../src/rawlog");
  const rt = createRuntime({ dataDir: dir, agents: new Agents(dir, () => ""), provider: () => { throw new Error("No provider authorized"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(dir, "log")), send: () => {}, fmRoot: join(dir, "protected") } as any);
  const call = async (path: string, body?: any, kind = "desktop") => { const u = new URL("http://fixture" + path), w = body !== undefined;
    const r = await rt.handle(new Request(u, { method: w ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(w ? { body: JSON.stringify(body) } : {}) }), u, { kind } as any, w); return { status: r!.status, body: (await r!.json()) as any }; };
  const got = await call("/api/issue-categories/p");
  ok(got.status === 200 && got.body.list.find((c: any) => c.id === "C-1").issues.includes(1), "the project page reads its categories with their issues");
  ok((await call("/api/issue-categories/none-yet")).body.state === "none", "a project with no categories reads as none");
  ok((await call("/api/issue-categories/p/start", {}, "phone")).status === 403 && (await call("/api/issue-categories/p/edit", { op: "rename", id: "C-1", name: "x" }, "phone")).status === 403, "only the desktop captain starts a run or edits");
  ok((await call("/api/issue-categories/p/edit", { op: "delete", id: "C-1" })).status === 400 && (await call("/api/issue-categories/p/edit", { op: "move", n: "5", to: "C-1" })).status === 400, "an edit is rename, move or merge, with valid ids");
  const ren = await call("/api/issue-categories/p/edit", { op: "rename", id: "C-1", name: "內嵌網頁與介面" });
  ok(ren.status === 200 && st.get("p")!.categories.find((c) => c.id === "C-1")!.name === "內嵌網頁與介面", "the captain renames a category from the page");
  ok((await call("/api/issue-categories/p/edit", { op: "move", n: 1, to: "C-2" })).status === 409, "moving into a category that is not active is refused");
  { const cur = st.get("p")!; st.write({ ...cur, categories: [...cur.categories, { id: "C-9", name: "待決", scope: "left by a run that ended", status: "proposed", createdAt: at, createdBy: "R-9 (m)" }], lastCategory: 9 }); }
  ok((await call("/api/issue-categories/p/edit", { op: "approve", ids: ["../x"] })).status === 400 && (await call("/api/issue-categories/p/edit", { op: "approve", ids: [] })).status === 400, "approving names one or more categories (C-n)");
  const appr = await call("/api/issue-categories/p/edit", { op: "approve", ids: ["C-9"] });
  ok(appr.status === 200 && st.get("p")!.categories.find((c) => c.id === "C-9")!.status === "active", "a proposal left by a run that ended is approved from the page", JSON.stringify(appr.body));
  ok((await call("/api/issue-categories/p/edit", { op: "decline", ids: ["C-9"] })).status === 409, "a category no longer waiting cannot be declined");
  const tag = await call("/api/issue-categories/p/edit", { op: "move", n: 6, to: "PLANNED" });
  ok(tag.status === 200 && st.get("p")!.assignments["6"].category === "PLANNED" && (await call("/api/issue-categories/p")).body.planned.map((x: any) => x.n).includes(6), "the captain tags an issue as planned from the page, and the page lists it apart", JSON.stringify(tag.body));
  ok((await call("/api/issue-categories/p/edit", { op: "unplan", n: 6 })).status === 200 && st.get("p")!.assignments["6"].notPlanned === true, "the captain takes an issue off planned from the page");
  ok((await call("/api/issue-categories/p/edit", { op: "unplan", n: "6" })).status === 400 && (await call("/api/issue-categories/p/edit", { op: "move", n: 6, to: "planned" })).status === 400, "unplan takes an issue number; planned is spelled PLANNED");
  ok((await call("/api/issue-categories/p/start", {})).status === 409, "a project that is not connected to GitHub cannot be filed");
  ok((await call("/api/issue-categories/p", {})).status === 405, "the categories cannot be written through the read route");
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`issue-categories: ${pass} passed, 0 failed`);
