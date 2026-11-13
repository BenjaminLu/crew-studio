import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Activity page's list on the server (src/activity-list.ts): the whole event log filtered, counted and paged, so the page
// never filters only the newest events it loaded. Free words in either Chinese script, exact facet values and key:value
// prefixes, counts that are "events left if you also tick this", newest or oldest first, pages and their sizes.
//   bun tests/activity-list.ts
import { activityPage, activityQuery } from "../src/activity-list";
import type { Ev } from "../src/fm";
let pass = 0, fail = 0;
const ok = (v: any, name: string, extra = "") => { if (v) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const types = ["task_started", "card_opened", "node_failed", "merged"], actors = ["captain", "worker-1", "reviewer-2"];
const events: Ev[] = Array.from({ length: 1000 }, (_, i) => ({ seq: i + 1, ts: new Date(Date.UTC(2026, 10, 1) + i * 60000).toISOString(), actor: actors[i % 3], type: types[i % 4], task: i % 10 ? `T-${i % 7}` : null, project: null, pr: null,
  summary: i === 500 ? { en: "Software update flow", "zh-TW": "軟體更新流程" } : { en: `Step ${i}`, "zh-TW": `步驟 ${i}` }, activity: null, role: null, round: null, decision: null, chosen: null, effect: null }));
const q = (s: string) => activityQuery(new URLSearchParams(s));

{ const r = activityPage(events, q("page=1"));
  ok(r.total === 1000 && r.matched === 1000 && r.rows.length === 25 && r.rows[0].seq === 1000, "no filter: every event counted, 25 a page, newest first");
  ok(activityPage(events, q("page=40")).rows.at(-1)!.seq === 1 && activityPage(events, q("page=99")).page === 40, "the last page holds the oldest; a page past the end is the last");
  ok(activityPage(events, q("page=1&sort=old")).rows[0].seq === 1 && activityPage(events, q("page=1&size=100")).rows.length === 100 && activityPage(events, q("page=1&size=7")).rows.length === 25, "oldest first; 100 a page; a size not offered is 25"); }
{ const r = activityPage(events, q("page=1&type=node_failed"));
  ok(r.matched === 250 && r.rows.every((e) => e.type === "node_failed"), "a type ticked: only that type, all of them counted");
  ok(r.counts.type.merged === 250 && r.counts.type.node_failed === 250, "the type facet's counts ignore its own selection");
  ok(r.counts.actor.captain === events.filter((e) => e.type === "node_failed" && e.actor === "captain").length, "another facet's counts apply the type filter");
  ok(activityPage(events, q("page=1&type=node_failed&type=merged")).matched === 500, "two values of one facet: either"); }
{ ok(activityPage(events, q("page=1&tok.actor=work")).matched === events.filter((e) => e.actor.startsWith("worker")).length && activityPage(events, q("page=1&tok.actor=WORK")).matched === events.filter((e) => e.actor.startsWith("worker")).length, "a key:value word matches from the start, any case");
  ok(activityPage(events, q("page=1&task=T-3")).rows.every((e) => e.task === "T-3") && !activityPage(events, q("page=1&task=T-3")).counts.task["null"], "the task facet; an event with no task has no task value"); }
{ ok(activityPage(events, q("page=1&q=软件")).matched === 1 && activityPage(events, q("page=1&q=軟體")).matched === 1 && activityPage(events, q("page=1&q=SOFTWARE update")).matched === 1, "a free word reads both languages of the summary, in either Chinese script");
  ok(activityPage(events, q("page=1&q=step 99")).matched === events.filter((e) => /^Step .*99/.test(e.summary.en)).length && activityPage(events, q("page=1&q=step nothing")).matched === 0, "every word must match");
  const r = activityPage(events, q("page=1&q=worker-1"));
  ok(r.matched === events.filter((e) => e.actor === "worker-1").length && r.counts.type.merged === events.filter((e) => e.actor === "worker-1" && e.type === "merged").length, "the counts follow the free text"); }

console.log(`\nactivity-list: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
