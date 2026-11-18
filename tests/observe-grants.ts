import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Studio's read tools under an external CLI grant (docs/units/cli-mcp-grant.md, scope "observe"): only the kinds the grant
// was given, only its project's entities, no focus, no external text unless the captain ticked it (and studio_find never
// matches it), never settings, grants, peers, terminals or focus; a tool the grant cannot use is not listed. Acceptance
// question 8: a "review only" grant answers question 1's pull request and question, cannot answer question 3, cannot search
// its way out, and never sees nor finds the pull request's own text.
//      bun tests/observe-grants.ts
import { suite } from "./rt-harness";
import { observeP2Fixture, INJECTION, ROOM, REPO } from "./lib/observe-p2-fixture";
import { createObserve } from "../src/observe/tools";
import { readObserve, grantableKinds, KIND_GROUPS } from "../src/observe/grant-scope";
import { NEVER_GRANTABLE, type GrantView } from "../src/observe/registry";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("observe-grants");
const J = (v: unknown) => JSON.stringify(v);
const failOf = async (f: () => unknown) => { try { await f(); return null; } catch (e: any) { return { code: e?.publicFailure?.code ?? null, en: String(e?.message ?? e) }; } };
const F = await observeP2Fixture();
const as = (g: Partial<GrantView>) => createObserve(F.sources as any, { id: "g-0000beef", kinds: [], project: null, untrusted: false, ...g });
try {
  // ---------- the presets and groups ----------
  ok(J(readObserve({ preset: "review" }).kinds) === J(["room"]) && readObserve({ preset: "review" }).untrusted === false, "\"review only\": review rooms, external text left out by default");
  ok(J(readObserve({ preset: "project" }).kinds) === J(grantableKinds()) && !grantableKinds().some((k) => (NEVER_GRANTABLE as readonly string[]).includes(k)), "\"this project\": every grantable kind, none of the never-grantable ones", J(grantableKinds()));
  ok(J(KIND_GROUPS.flatMap((g) => g.kinds).sort()) === J([...grantableKinds()].sort()) && KIND_GROUPS.find((g) => g.id === "system")!.kinds.includes("doctor"), "the custom groups hold every grantable kind once; Doctor is in System", J(KIND_GROUPS));
  for (const k of ["settings", "terminal", "peer", "grant", "focus"]) { let e = ""; try { readObserve({ preset: "custom", kinds: ["task", k] }); } catch (x: any) { e = x.message; } ok(/never reads/.test(e), `a custom grant can never read ${k}`, e); }
  ok(J(readObserve({ preset: "custom", kinds: ["doc", "task"], untrusted: true })) === J({ preset: "custom", kinds: ["task", "doc"], untrusted: true }), "a custom grant reads its kinds; ticking external text is kept");

  // ---------- acceptance 8: a "review only" grant ----------
  const R = as({ kinds: readObserve({ preset: "review" }).kinds });
  const names = R.specs.map((s) => s.name);
  ok(J(names) === J(["studio_now", "studio_find", "studio_list", "studio_get", "studio_logs", "studio_events"]) && R.specs.every((s: any) => { const e = s.inputSchema.properties.kind?.enum ?? s.inputSchema.properties.kinds?.items?.enum; return !e || J(e) === J(["room"]); }),
    "the read tools a review grant lists name only the room kind", J(R.specs.map((s: any) => [s.name, s.inputSchema.properties.kind?.enum ?? s.inputSchema.properties.kinds?.items?.enum])));
  const rooms: any = await R.call("studio_list", { kind: "room" }), room: any = await R.call("studio_get", { ref: rooms.items[0].ref });
  ok(room.data.subject.number === 1645 && room.data.subject.repository === REPO && room.data.turns[0].question === "Why does the retry give up after five attempts?", "Q8: it answers question 1's pull request and the captain's question", J(room.data.subject));
  ok(!J(room).includes("IGNORE") && !("title" in (room.data.pr ?? {})) && room.untrusted.length === 0 && /does not include external text/.test(room.data.externalText), "Q8: no external text: no pull request title, no tutor answer, said so", J(room.data).slice(0, 400));
  const q3 = await failOf(() => R.call("studio_list", { kind: "pr", filter: { tab: "merged" } }));
  ok(/this grant does not read pr/.test(q3?.en ?? "") && /Valid kinds: room\./.test(q3!.en), "Q8: it cannot answer question 3: the pull request list is not in the grant", J(q3));
  const out1: any = await R.call("studio_find", { query: "1601" }), out2 = await failOf(() => R.call("studio_find", { query: "1645", kinds: ["pr"] })), out3 = await failOf(() => R.call("studio_get", { ref: `pr:${REPO}#1601` }));
  ok(out1.items.length === 0 && /does not read pr/.test(out2?.en ?? "") && /does not read pr/.test(out3?.en ?? ""), "Q8: studio_find cannot find its way to it, nor studio_get", J([out1.items, out2, out3]));
  const ev: any = await R.call("studio_events", {}), now: any = await R.call("studio_now", {});
  ok(ev.data.events.every((e: any) => e.refs.every((r: string) => r.startsWith("room:"))) && ev.data.events.length === 0 && !J(now).includes("pr:") && now.data.waiting.length === 0 && /never sees what the captain/.test(now.data.focus.note), "Q8: nor its events or studio_now (no cards, no focus)", J([ev.data.events.map((e: any) => e.refs), now.data.focus]));
  for (const words of ["retry the webhook", "Adds a retry", "Five attempts cover", "Please add a jitter"]) { const f: any = await R.call("studio_find", { query: words }); ok(f.items.length === 0, `Q8: searching the pull request's or the tutor's own words finds nothing ("${words}")`); }
  const withText = as({ kinds: ["room"], untrusted: true }), roomT: any = await withText.call("studio_get", { ref: rooms.items[0].ref });
  ok(roomT.data.pr.title?.untrusted === true && roomT.untrusted.includes("data.pr.title") && !roomT.data.externalText, "with \"include external text\" ticked: the pull request's title, wrapped as untrusted");
  ok(((await withText.call("studio_find", { query: "retry the webhook" })) as any).items.length === 0, "even then, studio_find never matches external text");

  // ---------- a project grant: its project's entities; Studio-wide kinds whole; what it may not see reads as missing ----------
  const P = as({ kinds: readObserve({ preset: "project" }).kinds, project: "harbor-app" });
  const tasks: any = await P.call("studio_list", { kind: "task" }), wf: any = await P.call("studio_list", { kind: "workflow" });
  ok(tasks.data.total === 0 && wf.data.total > 0, "a project grant lists none of another project's Tasks, and the whole workflow catalog", J([tasks.data.total, wf.data.total]));
  const hidden = await failOf(() => P.call("studio_get", { ref: `task:${F.ids.failed}` })), missing = await failOf(() => P.call("studio_get", { ref: "task:R-999" }));
  ok(hidden?.code === "not_found" && missing?.code === "not_found" && hidden.en.replace(F.ids.failed, "X") === missing.en.replace("R-999", "X"), "a Task outside the project reads exactly as a missing one", J([hidden, missing]));
  const projects: any = await P.call("studio_list", { kind: "project" });
  ok(J(projects.items.map((x: any) => x.ref)) === J(["project:harbor-app"]), "it sees its own project only", J(projects.items));
  const logs = await failOf(() => P.call("studio_logs", { ref: `task:${F.ids.failed}` }));
  ok(logs?.code === "not_found", "nor another project's Task's log", J(logs));
  for (const k of ["terminal", "settings", "peer"]) { const x = await failOf(() => P.call("studio_list", { kind: k })); ok(/this grant does not read/.test(x?.en ?? ""), `even a project grant never reads ${k}`, J(x)); }
  ok(!P.specs.some((s: any) => J(s).includes("\"terminal\"") || J(s).includes("\"settings\"") || J(s).includes("\"peer\"")), "its tool list names none of them");
  ok(((await P.call("studio_now", {})) as any).data.waiting.length === 0, "studio_now under a project grant: no other project's cards");

  // ---------- a tool a grant cannot use is not listed ----------
  const D = as({ kinds: ["doctor"] });
  ok(!D.specs.some((s) => s.name === "studio_logs") && D.specs.length === 5 && !D.has("studio_logs"), "a grant whose kinds have no log has no studio_logs at all", J(D.specs.map((s) => s.name)));
  ok(!!(await failOf(() => D.call("studio_logs", { ref: "doctor:claude" }))), "calling it anyway fails");
} finally { for (const r of F.E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) { try { await F.E.cancel(r.id); } catch {} } F.H.stop(); }
end();
