import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The list toolbar's pure part (public/list-tools.js compute / parse / suggest / pageList / the URL state), run as the page
// runs it, with the vendored OpenCC and i18n.js: free words over the page's text in either Chinese script, key:value tokens,
// facet counts that are "rows left if you also tick this", paging, the recent window and what it leaves out, suggestions,
// and the query the state is written to and read back from.      bun tests/list-tools.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
let pass = 0, fail = 0;
const ok = (v: any, name: string, extra = "") => { if (v) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const win: any = { addEventListener() {} };
for (const p of [join(root, "public/vendor", `opencc-js-${pkg.devDependencies["opencc-js"]}-t2cn.min.js`), join(root, "public/i18n.js"), join(root, "public/list-tools.js")])
  new Function("window", "globalThis", "self", "addEventListener", readFileSync(p, "utf8"))(win, win, win, win.addEventListener);
const LT = win.crewListTools;
ok(LT && typeof LT.compute === "function", "public/list-tools.js loads alone and exposes window.crewListTools");

const DAY = 86400e3, NOW = Date.parse("2026-11-13T12:00:00Z");
const states = ["running", "waiting", "done", "failed"];
const label = { running: "進行中", waiting: "等你", done: "完成", failed: "失敗" } as Record<string, string>;
const items = Array.from({ length: 120 }, (_, i) => ({ id: `R-${1000 + i}`, title: i === 7 ? "軟體更新流程" : `Fix item ${i}`, status: states[i % 4], workflow: i % 3 ? "code-change" : "documents",
  tags: i % 5 ? ["a"] : ["a", "b"], at: new Date(NOW - Math.floor(i / 2) * DAY).toISOString() }));
const cfg = { id: "t", text: (x: any) => [x.title, x.id, x.workflow], facets: [{ key: "status", name: "Status", value: (x: any) => x.status, show: (v: string) => label[v] || v },
  { key: "workflow", name: "Workflow", value: (x: any) => x.workflow }, { key: "tag", name: "Tag", value: (x: any) => x.tags }],
  sorts: [{ key: "new", cmp: (a: any, b: any) => b.at.localeCompare(a.at) }, { key: "title", cmp: (a: any, b: any) => a.title.localeCompare(b.title) }], recent: { days: 30, at: (x: any) => x.at } };
const st = (o: any = {}) => ({ q: "", f: {}, sort: null, page: 1, size: 25, old: false, ...o });
const run = (o: any = {}, c: any = cfg) => LT.compute(c, st(o), items, NOW);

// ---- the recent window ----
{ const v = run();
  const recent = items.filter((x) => Date.parse(x.at) >= NOW - 30 * DAY);
  ok(v.matched.length === recent.length && v.hiddenOld === items.length - recent.length, "by default only the last 30 days; the rest is counted, not dropped", `${v.matched.length} ${v.hiddenOld}`);
  ok(run({ old: true }).matched.length === items.length && run({ old: true }).hiddenOld === 0, "with old on, everything");
  ok(run({ q: "R-1110" }).matched.length === 0 && run({ q: "R-1110" }).hiddenOld === 1, "a search that only matches an older row says there is one older"); }
// ---- free text ----
{ ok(run({ q: "ITEM fix", old: true }).matched.length === 119 && run({ q: "fix ITEM 11", old: true }).matched.every((x: any) => /11/.test(x.title + x.id)) && run({ q: "fix nothing", old: true }).matched.length === 0, "free words: every word, any case, in any order, anywhere in the text");
  ok(run({ q: "软件", old: true }).matched.map((x: any) => x.id).join() === "R-1007", "a Simplified word finds a Traditional title (opencc-js)");
  ok(run({ q: "軟體", old: true }).matched.length === 1, "and the Traditional word too");
  ok(run({ q: "documents", old: true }).matched.length === 40, "the text covers what the page says it does (the workflow)");
  ok(run({ q: "R-10", old: true }).free[0] === "r-10", "the first free word, normalized, is the one marked"); }
// ---- tokens ----
{ const v = run({ q: "status:done", old: true });
  ok(v.matched.length === 30 && v.matched.every((x: any) => x.status === "done"), "key:value filters a facet");
  ok(run({ q: "status:完成", old: true }).matched.length === 30, "a value as the page shows it works too");
  ok(run({ q: "status:完", old: true }).matched.length === 30 && run({ q: "status:do", old: true }).matched.length === 30, "a token value matches from its start");
  ok(run({ q: "status:done status:failed", old: true }).matched.length === 60, "two values of one key: either");
  ok(run({ q: "nokey:done", old: true }).matched.length === 0 && run({ q: "nokey:done", old: true }).free[0] === "nokey:done", "a key that is not a facet is a free word");
  ok(run({ q: "workflow:\"code-change\"", old: true }).matched.length === 80, "a quoted value");
  ok(run({ q: "status:", old: true }).matched.length === items.length, "an empty value filters nothing");
  ok(LT.parse('a "b c" k:"x y" z', ["k"]).free.join("|") === "a|b c|z" && LT.parse('k:"x y"', ["k"]).tok.k[0] === "x y", "the words of a query"); }
// ---- checkboxes and counts ----
{ const v = run({ f: { status: ["done"] }, old: true });
  ok(v.matched.length === 30 && v.chips.length === 1 && v.chips[0].key === "status", "a ticked value filters and makes a chip");
  const st0 = v.facets.find((f: any) => f.key === "status"), wf = v.facets.find((f: any) => f.key === "workflow");
  ok(st0.opts.every((o: any) => o.n === 30) && st0.opts.find((o: any) => o.v === "done").on, "a facet's own counts ignore its own selection: each is what ticking it adds", JSON.stringify(st0.opts));
  ok(wf.opts.find((o: any) => o.v === "documents").n === v.matched.filter((x: any) => x.workflow === "documents").length, "another facet's counts apply every other filter");
  const tg = run({ old: true }).facets.find((f: any) => f.key === "tag");
  ok(tg.opts.find((o: any) => o.v === "b").n === 24 && tg.opts.find((o: any) => o.v === "a").n === 120, "a row with several values counts under each");
  ok(run({ f: { tag: ["b"] }, old: true }).matched.length === 24, "and filters by any of them");
  ok(run({ q: "fix", f: { status: ["running"] }, old: true }).facets.find((f: any) => f.key === "workflow").opts.reduce((a: number, o: any) => a + o.n, 0) === run({ q: "fix", f: { status: ["running"] }, old: true }).matched.length, "counts follow the free text too");
  const sel = run({ f: { status: ["gone"] }, old: true }).facets.find((f: any) => f.key === "status");
  ok(sel.opts.some((o: any) => o.v === "gone" && o.on && o.n === 0), "a selected value no row has still shows, ticked, so it can be removed");
  ok(st0.n === 1 && run({ q: "status:do", f: { status: ["done"] }, old: true }).facets.find((f: any) => f.key === "status").n === 2, "the button says how many values are selected, tokens included"); }
// ---- sort and paging ----
{ const v = run({ old: true });
  ok(v.pages === 5 && v.rows.length === 25 && v.from === 1 && v.to === 25 && v.rows[0].id === "R-1000", "25 a page, newest first by default");
  const p5 = run({ old: true, page: 5 }); ok(p5.rows.length === 20 && p5.from === 101 && p5.to === 120, "the last page holds the rest");
  ok(run({ old: true, page: 99 }).page === 5, "a page past the end shows the last");
  ok(run({ old: true, size: 100 }).pages === 2 && run({ old: true, size: 7 }).size === 25, "page size: 25, 50 or 100 only");
  ok(run({ old: true, sort: "title" }).rows[0].title === "Fix item 0" && run({ old: true, sort: "nope" }).sort === "new", "a sort by key; an unknown key is the first");
  ok(JSON.stringify(LT.pageList(1, 1)) === "[1]" && JSON.stringify(LT.pageList(5, 10)) === '[1,"…",4,5,6,"…",10]' && JSON.stringify(LT.pageList(2, 4)) === "[1,2,3,4]", "page numbers: first, last, current and neighbours, gaps as …"); }
// ---- suggestions ----
{ const s1 = run({ q: "fix status:" }).suggest;
  ok(s1.length === 4 && s1.every((g: any) => g.key === "status" && typeof g.n === "number") && s1[0].q.startsWith("fix status:"), "status: lists that facet's values with their counts", JSON.stringify(s1));
  ok(run({ q: "status:等" }).suggest.map((g: any) => g.val).join() === "等你" && run({ q: "status:等" }).suggest[0].q === "status:waiting ", "a value's first letters narrow it (as stored or as shown); picking writes the stored value, so a link reads the same in every language");
  ok(run({ q: "st" }).suggest.map((g: any) => g.key).join() === "status" && run({ q: "st" }).suggest[0].q === "status:", "a key's first letters suggest the key");
  ok(!run({ q: "status:done " }).suggest.length, "after a space, nothing");
  ok(run({ q: "workflow:" }).suggest.find((g: any) => g.val === "code-change").n === run().matched.filter((x: any) => x.workflow === "code-change").length, "a suggestion's count is over the rows shown (the recent window)"); }
// ---- the URL ----
{ const q = new URLSearchParams("q=fix+it&status=done&status=failed&page=3&sort=title&size=50&old=1&card=SC-1");
  const s = LT.readQuery(cfg, q);
  ok(s.q === "fix it" && s.f.status.join() === "done,failed" && s.page === 3 && s.sort === "title" && s.size === 50 && s.old, "the state reads back from the query");
  const w = LT.writeQuery(cfg, s, q);
  ok(w.get("card") === "SC-1" && w.getAll("status").join() === "done,failed" && w.get("page") === "3" && w.get("q") === "fix it", "it writes back the same, and keeps a parameter it does not own", w.toString());
  ok(LT.writeQuery(cfg, LT.readQuery(cfg, new URLSearchParams("")), null).toString() === "", "the default state writes no query");
  ok(LT.readQuery(cfg, new URLSearchParams("size=7&page=-2")).size === 25 && LT.readQuery(cfg, new URLSearchParams("page=-2")).page === 1, "a bad size or page reads as the default"); }
// ---- no window ----
{ const c2 = { ...cfg, recent: undefined }; const v = LT.compute(c2, st(), items, NOW); ok(v.matched.length === 120 && !v.recentOnly && v.hiddenOld === 0, "a list without a recent window shows everything"); }

console.log(`\nlist-tools: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
