import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Studio's read tools (docs/units/observe.md): one registry of kinds, one envelope, fields emitted only when declared, someone
// else's words wrapped as untrusted, the same four tools for Claude and Codex, and acceptance questions 1-4 and 9-13 answerable
// from what the tools return (the facts are there; a real model's answers are scripts/observe-eval.ts).
//      bun tests/observe-registry.ts
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { harness, suite, until } from "./rt-harness";
import { createRuntime } from "../src/runtime/index";
import { observeFixture, INJECTION, ROOM, REPO } from "./lib/observe-fixture";
import { BUDGET, ENVELOPE_SCHEMA, kinds, kindDefs, parseRef, shape, type KindDef } from "../src/observe/registry";
import { FocusStore, readReport } from "../src/observe/focus";
import { OBSERVE_TOOLS } from "../src/observe/tools";
import { NATIVE_TOOL_NAMES, STUDIO_TOOLS } from "../src/observe/catalog";
import { mcpToolList, codexDynamicTools } from "../src/host/types";
import { nativeEndpoint } from "../src/host/claude";
import { nativeFreshText } from "../src/host/main";
import { liveStatus } from "../src/firstmate-turn";
import { taskRow } from "../src/runtime/task-row";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("observe-registry");
const J = (v: unknown) => JSON.stringify(v);
const bytes = (v: unknown) => Buffer.byteLength(J(v));
const failOf = async (f: () => unknown) => { try { await f(); return null; } catch (e: any) { return { code: e?.publicFailure?.code ?? null, en: String(e?.message ?? e) }; } };

// the top-level keys of the object literal that opens at src[at] (as tests/route-names.ts reads the board's routes table)
function keys(src: string, at: number): string[] {
  const out: string[] = []; let depth = 0, expectKey = false;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") { const q = ch; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++; continue; }
    if ("{([".includes(ch)) { depth++; if (depth === 1) expectKey = true; continue; }
    if ("})]".includes(ch)) { depth--; if (depth === 0) return out; continue; }
    if (depth === 1 && ch === ",") { expectKey = true; continue; }
    if (depth === 1 && expectKey && /\S/.test(ch)) { const m = /^(?:"([^"]+)"|'([^']+)'|([\w$-]+))\s*:/.exec(src.slice(i)); if (m) out.push(m[1] ?? m[2] ?? m[3]); expectKey = false; }
  }
  return out;
}
const F = await observeFixture();
const O = F.observe;
try {
  // ---------- the registry ----------
  ok(J(kinds()) === J(["task", "card", "room", "pr"]), "P1's kinds are task, card, room and pr, in registration order", J(kinds()));
  const specs = O.specs;
  ok(J(specs.map((s) => s.name)) === J([...OBSERVE_TOOLS]), "the four read tools, in a fixed order", J(specs.map((s) => s.name)));
  ok(specs.every((s) => s.annotations?.readOnlyHint === true && s.annotations?.destructiveHint === false && s.outputSchema === ENVELOPE_SCHEMA), "every read tool is annotated readOnlyHint and returns the one envelope schema");
  const listKinds = (specs.find((s) => s.name === "studio_list")!.inputSchema as any).properties.kind.enum, findKinds = (specs.find((s) => s.name === "studio_find")!.inputSchema as any).properties.kinds.items.enum;
  ok(J(listKinds) === J(kinds()) && J(findKinds) === J(kinds()), "studio_list's and studio_find's kind enums are made from the registry", J([listKinds, findKinds]));
  ok(J(specs) === J(O.specs) && J(specs.map((s) => s.name)) === J(F.observe.specs.map((s) => s.name)), "the specs are the same every time (a client's prompt cache keeps them)");
  ok(kindDefs().every((d) => d.viewer === "desktop" && typeof d.grantable === "boolean" && d.fields.every((f) => f.trust !== "untrusted" || !!f.source)), "every kind names its viewer, whether a grant may see it, and a source for each untrusted field");
  ok(J(parseRef("task:R-162")) === J({ kind: "task", id: "R-162" }) && J(parseRef(`studio://room/${ROOM}`)) === J({ kind: "room", id: ROOM }) && J(parseRef(`pr:${REPO}#1645`)) === J({ kind: "pr", id: `${REPO}#1645` }) && parseRef("R-162") === null,
    "refs are kind:id or studio://kind/id");

  // ---------- trust: declared fields only, untrusted wrapped, withheld dropped, redacted ----------
  const fake = { kind: "fixture", fields: [{ path: "status", trust: "studio" }, { path: "note", trust: "captain" }, { path: "body", trust: "untrusted", source: "a fixture's body" }, { path: "list", trust: "studio" }, { path: "list[].title", trust: "untrusted", source: "a fixture title" }] } as unknown as KindDef;
  const shaped = shape(fake, { status: "open", note: "mine", body: INJECTION, secretPlan: "undeclared", list: [{ n: 1, title: INJECTION }], nested: { status: "x" } });
  ok(!("secretPlan" in shaped.data) && !("nested" in shaped.data), "a field no kind declares is never emitted", J(shaped.data));
  ok(J(shaped.data.body) === J({ untrusted: true, source: "a fixture's body", text: INJECTION }) && J(shaped.untrusted) === J(["body", "list[0].title"]), "an untrusted field comes as {untrusted, source, text}, and its path is listed", J(shaped));
  ok(J((shaped.data.list as any)[0]) === J({ n: 1, title: { untrusted: true, source: "a fixture title", text: INJECTION } }), "a Studio list with an untrusted title inside is walked: the deeper declaration decides there", J(shaped.data.list));
  const held = shape(fake, { status: "open", body: INJECTION }, "work from a peer's Studio: its text is withheld");
  ok(!("body" in held.data) && held.data.withheld === "work from a peer's Studio: its text is withheld" && !J(held).includes("IGNORE"), "withheld (a peer's Studio, issue text): untrusted fields are dropped, not wrapped", J(held));
  const secret = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  ok(!J(shape(fake, { status: secret }).data).includes(secret), "every output goes through Studio's redaction");

  // ---------- acceptance 1: which pull request am I reviewing, what did I just ask, which chapter is the tutor on ----------
  F.focus.put("tab-a", { route: `#/room/${ROOM}`, ref: `room:${ROOM}`, selection: { kind: "scene", id: "3", label: "場景 3" }, dialog: null, label: "Review room · PR #1645 · 場景 3" });
  const openBefore = F.E.cards.list({ open: true }).length;
  const now1: any = await O.call("studio_now", {});
  ok(now1.data.focus.sharing === "on" && now1.data.focus.current.ref === `room:${ROOM}` && /ago$/.test(now1.data.focus.current.ago) && now1.data.focus.current.selection.label === "場景 3", "Q1: studio_now says the captain is in that room, on scene 3, and how long ago", J(now1.data.focus));
  const room: any = await O.call("studio_get", { ref: now1.data.focus.current.ref });
  ok(room.data.subject.number === 1645 && room.data.subject.repository === REPO, "Q1: the room names the pull request under review", J(room.data.subject));
  ok(room.data.turns[0].question === "Why does the retry give up after five attempts?" && room.data.turns[0].by === "captain", "Q1: the captain's last question, newest first, in their words (captain trust, not wrapped)", J(room.data.turns[0]));
  ok(room.data.lesson.current.chapter === "decisions" && room.data.lesson.current.scene === 3 && room.data.lesson.current.of === 3 && J(room.data.lesson.covered) === J(["what", "talks", "decisions"]), "Q1: the tutor's lesson is on chapter 3, decisions, at scene 3", J(room.data.lesson.current));
  ok(room.untrusted.includes("data.pr.title") && room.untrusted.some((p: string) => /turns\[\d+\]\.answer/.test(p)) && room._meta["studio/trust"].untrusted.length === room.untrusted.length, "the pull request's title and the tutor's answers are untrusted, in the envelope and _meta", J(room.untrusted));
  ok(!J(room.data).replace(/"text":"[^"]*IGNORE[^"]*"/g, "").includes("IGNORE"), "the injection line appears only inside untrusted text");
  ok(room.data.explain.runs[0].why === "limit" && room.data.explain.runs[0].cost.usd === 0.61 && room.data.cost.usd === 1.08, "the room's Explain-with run says why it stopped and what it cost; the room sums its costs", J([room.data.explain.runs[0], room.data.cost]));

  // ---------- acceptance 2: where is R-… stuck, why did it fail ----------
  const task: any = await O.call("studio_get", { ref: `task:${F.ids.failed}` });
  ok(task.data.status === "failed" && task.data.failure?.class && task.data.failure?.title?.en && task.data.failure?.meaning?.en, "Q2: the failed Task says it failed and Studio's typed reading of why", J(task.data.failure));
  ok(task.data.waitingOn.some((w: any) => w.kind === "failure") && /Deploy to staging/.test(J(task.data)), "Q2: and where: its failure card at the Deploy to staging step", J(task.data.waitingOn));
  ok(task.data.failure.message?.untrusted === true && /connection refused/.test(task.data.failure.message.text), "Q2: the step's own message is there, wrapped as untrusted", J(task.data.failure.message));
  const row = taskRow(F.E, F.E.get(F.ids.failed)!);
  ok(["id", "status", "workflow", "version", "createdAt", "updatedAt", "endedAt", "title", "request", "project"].every((k) => J(task.data[k]) === J((row as any)[k])) && J(task.data.current) === J(row.current), "a Task reads as the board's Tasks list row (the route's own taskRow)", J({ task: task.data, row }));

  // ---------- acceptance 3: which pull requests are merged but not live, on which pod ----------
  const merged: any = await O.call("studio_list", { kind: "pr", filter: { tab: "merged" } });
  ok(merged.items.length === 1 && merged.items[0].ref === `pr:${REPO}#1601` && merged.data.entries[0].waitsAt === "staging: tide-api (v1.4.0-1a2b3c4)", "Q3: the merged pull request not yet live, the environment and the pod it waits on", J(merged.data.entries[0]));
  ok(J(merged.data.entries[0].envs) === J(F.prView.merged[0].envs) && merged.data.entries[0].ship.waits === F.prView.merged[0].ship.waits, "a pull request reads as the board's /api/prs view (environments and pods unchanged)");

  // ---------- acceptance 4: what waits for me, what is the most urgent decision (never answered) ----------
  const cards: any = await O.call("studio_list", { kind: "card" });
  ok(cards.items[0].ref === `card:${F.ids.doorCard}` && cards.data.entries[0].urgency === "one-way door" && cards.data.entries[0].options.map((x: any) => x.id).join() === "go,hold", "Q4: the one-way door card comes first, with the choices the captain has", J(cards.data.entries[0]));
  ok(now1.data.waiting[0].ref === `card:${F.ids.doorCard}` && now1.data.counts.waiting === openBefore && now1.data.waiting.some((w: any) => w.kind === "failure"), "Q4: studio_now lists the same card first, then the failed Task's card", J(now1.data.waiting));
  ok(F.E.cards.list({ open: true }).length === openBefore && specs.every((s) => !/answer|approve|prepare|start|send/.test(s.name)), "Q4: reading answered nothing, and no read tool answers, approves or prepares a card");
  const shownCard = F.E.cards.view(F.E.cards.get(F.ids.doorCard)!);
  ok(J(cards.data.entries[0].options.map((x: any) => x.label)) === J(shownCard.options.map((x) => x.label)) && cards.data.entries[0].status === shownCard.status, "a card reads as the Inbox shows it (engine.cards.view)");

  // ---------- acceptance 9: what happened in the last hour ----------
  ok(["task:" + F.ids.failed, "card:" + F.E.cards.list({ run: F.ids.answered })[0].id, `room:${ROOM}`, `pr:${REPO}#1601`].every((r) => now1.data.recent.some((x: any) => x.ref === r)), "Q9: the last hour: the failed Task, the answered card, the room's answer, the merged pull request", J(now1.data.recent));
  ok(now1.data.recent.some((x: any) => /answered: go \(by captain\)/.test(x.what)), "Q9: an answered card says what the captain chose");

  // ---------- acceptance 10: a summary for the PM (free, citing the scenes) ----------
  const fullRoom: any = await O.call("studio_get", { ref: `room:${ROOM}`, depth: "full" });
  ok(fullRoom.data.lesson.sceneList.length === 3 && fullRoom.data.lesson.sceneList[2].title.text === "Why retry with backoff" && fullRoom.data.explain.versions[0].prompt === "Keep it to one page for the PM", "Q10: the full room holds every scene to cite and the explainer's version", J(fullRoom.data.lesson.sceneList));
  ok(bytes(fullRoom) <= BUDGET.full && bytes(room) <= BUDGET.summary, "summary within 4 KB, full within 24 KB", `${bytes(room)} ${bytes(fullRoom)}`);

  // ---------- acceptance 11: what should I do on this screen (never answering it) ----------
  F.focus.put("tab-a", { route: `#/inbox/${F.ids.doorCard}`, ref: `card:${F.ids.doorCard}`, selection: null, dialog: "door-confirm", label: "Inbox · " + F.ids.doorCard });
  const now11: any = await O.call("studio_now", {});
  const card11: any = await O.call("studio_get", { ref: now11.data.focus.current.ref });
  ok(now11.data.focus.current.dialog === "door-confirm" && card11.data.confirmDoor === true && card11.data.options.length === 2 && F.E.cards.get(F.ids.doorCard)!.status === "open", "Q11: the card on screen, its door confirmation and its choices; it stays open", J(now11.data.focus.current));

  // ---------- acceptance 13: two windows: the one used last, the other named ----------
  F.focus.put("tab-b", { route: "#/prs", ref: null, selection: null, dialog: null, label: "Pull requests" });
  const now13: any = await O.call("studio_now", {});
  ok(now13.data.focus.current.route === "#/prs" && now13.data.focus.otherWindows.length === 1 && now13.data.focus.otherWindows[0].ref === `card:${F.ids.doorCard}`, "Q13: the window used last is current; the other window is named", J(now13.data.focus));
  F.focus.put("tab-c", { route: "#/board", ref: null, selection: null, dialog: null, label: "Board" }, false);
  ok(((await O.call("studio_now", {})) as any).data.focus.current.route === "#/prs", "a background window's report does not move what is on screen");
  F.setClock(Date.now() + 11 * 60_000);
  const stale: any = await O.call("studio_now", {});
  ok(!stale.data.focus.current && stale.data.focus.last?.stale === true && /Last seen/.test(stale.data.focus.note), "over 10 minutes it is 'last seen', not 'now'", J(stale.data.focus));
  F.setClock(Date.now());

  // ---------- acceptance 12: sharing off: nothing to guess from ----------
  F.focus.setSharing(false);
  const off: any = await O.call("studio_now", {});
  ok(off.data.focus.sharing === "off" && !off.data.focus.current && !off.data.focus.last && /Do not guess/.test(off.data.focus.note) && !J(off.data.focus).includes(ROOM), "Q12: sharing off: studio_now says so and holds no page", J(off.data.focus));
  ok(!F.focus.put("tab-a", { route: "#/board", ref: null, selection: null, dialog: null, label: null }) && F.focus.now().recent.length === 0, "while sharing is off a report is refused and nothing was kept");
  F.focus.setSharing(true);

  // ---------- focus reports: ids and Studio's labels only ----------
  ok(!readReport({ route: "#/room/x", tab: "t1", typed: "half a sentence" }).ok && !readReport({ route: "#/room/x", tab: "t1", selection: { kind: "scene", id: "3", label: "x", text: "draft" } }).ok, "a report carrying anything else (typed text) is refused");
  const long = readReport({ route: "#/room/x", tab: "t1", label: "L".repeat(500), selection: { kind: "scene", id: "3", label: "S".repeat(500) } });
  ok(long.ok && long.report.label!.length === 80 && long.report.selection!.label.length === 80, "labels are capped");
  const fs2 = new FocusStore(null); for (let i = 0; i < 30; i++) fs2.put("t", { route: `#/run/R-${i}`, ref: null, selection: null, dialog: null, label: null });
  ok(fs2.now().recent.length === 20, "only the last 20 reports are kept, in memory");
  const dir = mkdtempSync(join(tmpdir(), "crew-focus-")); new FocusStore(dir).setSharing(false);
  ok(new FocusStore(dir).on === false && new FocusStore(null).on === true, "sharing is on by default; turning it off is remembered");

  // ---------- envelopes, pages, errors ----------
  for (let i = 0; i < 30; i++) F.E.start({ workflow: "deploy-fixture", version: 1, title: `Batch ${i}`, text: `batch ${i}`, by: "fixture", params: {} } as any);
  await until(() => F.E.list().filter((r) => r.status === "failed").length >= 31);
  const p1: any = await O.call("studio_list", { kind: "task" });
  ok(!!p1.nextCursor && p1.items.length > 0 && p1.items.length === p1.data.entries.length && bytes(p1) <= BUDGET.summary, "a long list pages within its budget, with a cursor", `${p1.items.length} ${bytes(p1)}`);
  const p2: any = await O.call("studio_list", { kind: "task", cursor: p1.nextCursor });
  ok(p2.data.offset === p1.items.length && !p2.items.some((x: any) => p1.items.some((y: any) => y.ref === x.ref)), "the cursor goes on where the page ended");
  const wrongCursor = await failOf(() => O.call("studio_list", { kind: "card", cursor: p1.nextCursor }));
  ok(wrongCursor?.code === "invalid_params" && /without cursor/.test(wrongCursor.en), "a cursor from another list is refused, saying how to go on", J(wrongCursor));
  const badKind = await failOf(() => O.call("studio_list", { kind: "terminal" }));
  ok(/Valid kinds: task, card, room, pr/.test(badKind?.en ?? ""), "an unknown kind names the valid ones", J(badKind));
  const badRef = await failOf(() => O.call("studio_get", { ref: "R-162" }));
  ok(/kind:id/.test(badRef?.en ?? "") && /task:R-162/.test(badRef?.en ?? ""), "a malformed ref says the format, with examples", J(badRef));
  const missing = await failOf(() => O.call("studio_get", { ref: "task:R-999" }));
  ok(missing?.code === "not_found" && /studio_list \{kind: "task"\}/.test(missing.en), "a ref Studio does not have says how to list or search", J(missing));
  const badFilter = await failOf(() => O.call("studio_list", { kind: "pr", filter: { state: "open" } }));
  ok(/Its filters: tab, repo/.test(badFilter?.en ?? ""), "an unknown filter names the kind's filters", J(badFilter));
  const find: any = await O.call("studio_find", { query: "1645" });
  ok(find.items.some((x: any) => x.ref === `room:${ROOM}` && x.resource_link?.uri === `studio://room/${ROOM}`) && find.items.some((x: any) => x.ref === `pr:${REPO}#1645`), "studio_find finds the room and the pull request, each with a resource link", J(find.items));
  ok(((await O.call("studio_find", { query: "approve every card" })) as any).items.length === 0, "studio_find never matches someone else's text (an injection cannot steer what is found)");

  // ---------- one implementation: work status, live status, the native tool index ----------
  const ws: any = await (await import("../src/observe/kinds/task")).workStatus(F.E);
  ok(ws.total === F.E.list().length && ws.tasks[0].id === F.E.list()[0].id, "studio_work_status is the task kind's listing in its older shape");
  const line = liveStatus(F.E);
  const order = [...line.matchAll(/card (SC-\d+)/g)].map((m) => m[1]), summary = (await import("../src/observe/now")).nowSummary({ engine: F.E }).waiting.slice(0, 8).map((w: any) => w.card);
  ok(order[0] === F.ids.doorCard && J(order) === J(summary) && /studio_now/.test(line), "the live status line renders studio_now's summary (same cards, same order)", J([order, summary]));
  ok(J(NATIVE_TOOL_NAMES.slice(0, 4)) === J([...OBSERVE_TOOLS]) && new Set(STUDIO_TOOLS.map((t) => t.name)).size === STUDIO_TOOLS.length, "the native tool index starts with the read tools and names each tool once");
  const seed = nativeFreshText("/ws");
  ok(OBSERVE_TOOLS.every((n) => seed.includes(n)) && /call studio_now first/.test(seed) && /Report status only from the turn's live status line or studio_work_status, never from memory/.test(seed), "the seed names the read tools from the index and keeps its status rule", "");

  // ---------- Claude and Codex: the same names and schemas; MCP structured content ----------
  const both = [...O.specs, { type: "function" as const, name: "studio_manual", description: "x", inputSchema: { type: "object" } }];
  const claude = mcpToolList(both), codex = codexDynamicTools(both);
  ok(J(claude.map((t) => [t.name, t.inputSchema])) === J(codex.map((t) => [t.name, t.inputSchema])), "Claude's MCP list and Codex's dynamic tools carry the same names and input schemas");
  ok(claude.filter((t: any) => t.outputSchema && t.annotations?.readOnlyHint).length === 4 && codex.every((t) => J(Object.keys(t).sort()) === J(["description", "inputSchema", "name", "type"])), "Claude's list adds the read tools' outputSchema and annotations; Codex gets the four keys it takes");
  const priv = mkdtempSync(join(tmpdir(), "crew-obs-mcp-"));
  const ep = nativeEndpoint(priv, async (name, args) => { if (name === null) return mcpToolList(O.specs); try { return await O.call(name, args); } catch (e: any) { return { error: e.message, failure: e.publicFailure }; } });
  const mcp = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "mcp.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_STUDIO_SOCKET: ep.socket, CREW_TOOL_TOKEN_FILE: ep.tokenFile } });
  const lines: any[] = []; (async () => { const dec = new TextDecoder(); let buf = ""; for await (const ch of mcp.stdout as any) { buf += dec.decode(ch); let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } } })();
  const rpc = async (id: number, method: string, params: unknown) => { mcp.stdin.write(J({ jsonrpc: "2.0", id, method, params }) + "\n"); await mcp.stdin.flush(); await until(() => lines.some((l) => l.id === id), 15000); return lines.find((l) => l.id === id); };
  try {
    const listed = await rpc(1, "tools/list", {});
    ok(listed.result.tools.length === 4 && listed.result.tools.every((t: any) => t.outputSchema && t.annotations?.readOnlyHint), "over MCP, tools/list carries outputSchema and readOnlyHint", J(listed.result.tools.map((t: any) => t.name)));
    const got = await rpc(2, "tools/call", { name: "studio_get", arguments: { ref: `pr:${REPO}#1645` } });
    ok(got.result.isError === false && got.result.structuredContent?.ref === `pr:${REPO}#1645` && J(JSON.parse(got.result.content[0].text)) === J(got.result.structuredContent) && got.result._meta?.["studio/trust"]?.untrusted?.includes("data.title") && !("_meta" in got.result.structuredContent),
      "over MCP, a read returns structuredContent, the same JSON as text, and the trust note as _meta", J(got.result).slice(0, 300));
    const err = await rpc(3, "tools/call", { name: "studio_list", arguments: { kind: "nope" } });
    ok(err.result.isError === true && /Valid kinds/.test(err.result.content[0].text) && !err.result.structuredContent, "over MCP, a mistake is isError with how to fix it", J(err.result));
  } finally { mcp.kill(); ep.close(); }

  // ---------- Studio's runtime: the live tool list is the index; the room route and the provider read the same view ----------
  { const H2 = await harness([]), root = join(import.meta.dir, "..");
    try { const rt = createRuntime({ dataDir: H2.data, agents: H2.agents, provider: H2.engine.deps.provider, defaultProvider: () => ({ provider: "stub", model: null }), log: H2.engine.deps.log, send() {}, fmRoot: root, protectedRoots: [root], studioUrl: () => H2.toolUrl } as any);
      const live = rt.firstmate.specs.map((x: any) => x.name), index = STUDIO_TOOLS.map((t) => t.name);
      ok(live.every((n: string) => index.includes(n)) && NATIVE_TOOL_NAMES.every((n) => live.includes(n)) && J(live.slice(0, 4)) === J([...OBSERVE_TOOLS]), "every registered Firstmate tool is in the index, every always-registered one is registered, the read tools first", J(live.filter((n: string) => !index.includes(n))));
      (rt.engine as any).reviewRoom = F.reviewRoom;
      const res = await rt.handle(new Request(`http://127.0.0.1/api/review-room/${ROOM}`), new URL(`http://127.0.0.1/api/review-room/${ROOM}`), { kind: "desktop" }, false);
      const routeView: any = await res!.json(), viaTool: any = await rt.observe.call("studio_get", { ref: `room:${ROOM}` });
      ok(res!.status === 200 && viaTool.data.subject.number === routeView.subject.number && viaTool.data.pr.state === routeView.prState.state && viaTool.data.pr.title.text === routeView.prState.title && viaTool.data.turns[0].question === routeView.turns.at(-1).text && viaTool.data.questions.asked === routeView.turns.length,
        "the room reads as GET /api/review-room/<room> returns it", J({ route: routeView.prState, tool: viaTool.data.pr }));
      const notOpened = await rt.observe.call("studio_get", { ref: `room:${ROOM}`, depth: "full" });
      ok(!!notOpened, "reading a room never opens it (the fixture refuses opened=true)");
    } finally { H2.stop(); } }

  // ---------- coverage: every board route is a kind's, or on the pending list (which shrinks each phase) ----------
  const PENDING = ["activity", "artifact", "board", "change", "changes", "compare", "court", "crew", "doc", "docs", "doctor", "edit", "event", "fileorg", "first-workflow", "firstmate", "gates", "improve", "lan", "library", "pack", "pack-genesis", "packs", "pro", "project", "projects", "remote", "retro", "review", "roadmap", "settings", "skill", "skills", "skins", "takeover", "team", "terminals", "workflow", "workflows"];
  const NEVER = ["settings", "remote", "lan", "takeover", "terminals"]; // never grantable; terminals: status only, P2
  const routes = new Set<string>();
  for (const f of readdirSync(join(import.meta.dir, "..", "public")).filter((f) => f.endsWith(".js"))) { const src = readFileSync(join(import.meta.dir, "..", "public", f), "utf8");
    for (const m of src.matchAll(/\broutes\.([\w$]+)\s*=(?!=)/g)) routes.add(m[1]); for (const m of src.matchAll(/\broutes\[\s*["']([^"']+)["']\s*\]\s*=(?!=)/g)) routes.add(m[1]);
    for (const m of src.matchAll(/Object\.assign\(\s*routes\s*,\s*\{/g)) for (const k of keys(src, m.index! + m[0].length - 1)) routes.add(k);
    for (const m of src.matchAll(/\bconst routes\s*=\s*\{/g)) for (const k of keys(src, m.index! + m[0].length - 1)) routes.add(k); }
  const covered = new Set(kindDefs().flatMap((d) => [d.route, d.listRoute]).map((r) => /^#\/([\w-]+)/.exec(r)?.[1]).filter(Boolean) as string[]);
  for (const alias of ["run", "runs", "task"]) if (covered.has("run")) covered.add(alias);
  const uncovered = [...routes].filter((r) => !covered.has(r) && !PENDING.includes(r));
  ok(routes.size > 30 && !uncovered.length, "every board route has a kind or is on the pending list", J(uncovered));
  ok(PENDING.every((r) => routes.has(r)) && PENDING.every((r) => !covered.has(r)), "the pending list names only real routes that no kind covers yet", J(PENDING.filter((r) => !routes.has(r) || covered.has(r))));
  ok(NEVER.every((r) => PENDING.includes(r)) && kindDefs().every((d) => d.grantable === !NEVER.includes(d.kind)), "settings, remote, peers and terminals have no grantable kind");
} finally { for (const r of F.E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) { try { await F.E.cancel(r.id); } catch {} } F.H.stop(); }
end();
