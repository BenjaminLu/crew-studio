import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The live E2E's Firstmate findings (scratchpad e2e-sandbox.md), each with what the captain wants to see:
//  S3  "幫我寫一份文件…" is a Documents proposal, not a file Firstmate writes itself: studio_list_workflows routes each
//      deliverable, the captain turn carries the route, and writing a deliverable file anyway is shown and reminded.
//  S5  Firstmate described the old Board ("cards + crew on duty") and could not find the Crew team page: the manual
//      (studio_manual studio/pages) describes today's Board, Inbox and Crew page, and the seed sends it there.
//  S7  One message naming three deliverables yielded one card and "say 繼續" twice: one proposal per separate part
//      of the captain's message, each quoting it and each with its own card; invented or duplicate work is refused.
//  S8  After the captain approved the image seat card, the images proposal waited for the captain to ask again: Studio
//      proposes the held work again by itself and tells Firstmate; held proposals are on disk, so a restart keeps them.
//  S10 Firstmate listed answered cards as still waiting: every captain turn carries the live open-card and Task line,
//      and status claims come from it or studio_work_status in the same turn.
//  S23 An escalation Studio sent Firstmate showed in the chat as its raw English prompt with tool syntax: the chat line
//      carries a short summary (Task, what is stuck, Firstmate is looking); Firstmate still gets the full prompt.
// No model is called: a fake in-process host stands in for the CLI, and the tools run on the real engine.
//      bun tests/firstmate-live-e2e.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, until } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { installFirstmate, heldNotice } from "../src/firstmate";
import { Projects } from "../src/doors";
import { deliverableKinds, routeRequest } from "../src/deliverables";
import { routingNote, firstmateTurnNote, escalationShown, questionShown } from "../src/firstmate-turn";
import { studioManual, manualSection, manualPage } from "../src/manual";
import { MainSession, nativeFreshText, type TurnNote } from "../src/host/main";
process.env.CREW_TEST_IN_PROCESS = "1";
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : " " + extra}`); v ? pass++ : fail++; };
const section = async (name: string, f: () => Promise<void>) => { try { await f(); } catch (e: any) { fail++; console.log(`FAIL ${name}: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")}`); } };

// ---------- a fake host: records every turn it is sent and plays a script per turn ----------
type Turn = { emit: (e: any) => void; call: (name: string, args: unknown) => Promise<unknown> };
function fakeHost(script: (text: string, t: Turn) => Promise<void> | void = () => {}) {
  const sent: string[] = [];
  const host: any = { id: "codex", discover: async () => [], resumeCommand: (id: string) => `codex resume ${id}`,
    attach: async (_id: string, o: any) => {
      const s: any = { host: "codex", id: "fake-thread", model: "fake-model", effort: null, path: "fresh", file: null, busy: false,
        async send(text: string) {
          sent.push(text); s.busy = true; const turn = String(sent.length);
          try { await script(text, { emit: o.onEvent, call: (name, args) => o.nativeTools.call(name, args, { thread: s.id, turn, call: `c${turn}`, live: () => true }) }); } catch {}
          s.busy = false; o.onEvent({ type: "message", text: "ok" }); return { status: "completed" };
        },
        interrupt: async () => {}, detach: async () => "codex resume fake-thread" };
      return s;
    } };
  return { host, sent };
}
async function mainWith(o: { script?: Parameters<typeof fakeHost>[0]; turnNote?: (t: string) => TurnNote | null; tools?: any }) {
  const dir = mkdtempSync(join(tmpdir(), "crew-fm-live-")), state = join(dir, "state"); mkdirSync(state, { recursive: true });
  const f = fakeHost(o.script);
  const m = new MainSession({ dataDir: join(dir, "data"), projectDir: join(dir, "workspace"), stateDir: state, hosts: { codex: f.host, claude: f.host } as any, pollMs: 50, wakeGraceMs: 0,
    nativeWorkspace: true, permissionMcp: () => ({ command: ["true"], env: {} }), nativeTools: () => o.tools ?? { specs: [], call: async () => ({ proposal: "R-1" }) }, turnNote: o.turnNote });
  mkdirSync(join(dir, "data"), { recursive: true }); mkdirSync(join(dir, "workspace"), { recursive: true });
  await m.start(); const r = await m.startFresh("codex"); if (!r.ok) throw new Error(`fresh start: ${r.reason}`);
  await until(() => f.sent.length >= 1 && !m.view().busy, 5000); // the seed turn
  const say = async (text: string, kind: any = "chat", source = "desktop") => { const n = f.sent.length; m.enqueue(kind, text, source); await until(() => f.sent.length > n && !m.view().busy && !m.view().queue.length, 5000); return f.sent.at(-1)!; };
  return { m, sent: f.sent, say, done: () => { m.stop(); rmSync(dir, { recursive: true, force: true }); } };
}
const SHIPPED: Record<string, string> = { doc: "documents", web: "web-prototype", image: "images", video: "video", code: "code-firstmate", files: "file-organization" };
const of = (k: string) => SHIPPED[k] ?? null;

// ---------- S3: routing by deliverable ----------
const DOC = "幫我寫一份文件：「Crew Studio 新手三分鐘上手」，給第一次打開 Studio 的同事看，說明看板、收件匣、船員頁各是做什麼的，怎麼派第一個工作。用繁體中文，一頁以內。";
await section("S3 routing", async () => {
  ok(routeRequest(DOC, of).map((r) => r.workflow).join() === "documents", "the live request for a document routes to documents", JSON.stringify(routeRequest(DOC, of)));
  ok(deliverableKinds("用檔案整理流程，整理它內建的示範資料夾，依類型分類。").join() === "files", "tidying a folder is file organisation, not a document");
  ok(routeRequest("你自己幫我寫一份文件，直接存在你的工作區就好", of).length === 0, "an explicit hands-on request routes nothing");
  ok(routeRequest("再派三個工作：1) 網頁原型：單頁網站 2) 圖片：主視覺 3) 短片：15 秒宣傳短片", of).map((r) => r.workflow).join() === "web-prototype,images,video", "several deliverables in one message each get their workflow");
  ok(/deliverable[^.]*becomes a proposal[^.]*hands-on yourself only when the captain explicitly asks/.test(nativeFreshText("/ws")), "Firstmate's standing text says a deliverable is a proposal, hands-on only on request");
  const note = routingNote(DOC, of);
  ok(!!note && note.routes[0]?.workflow === "documents" && /a document, report or article → documents/.test(note.text) && /hands-on yourself only if the captain explicitly asks/.test(note.text), "the turn note names the deliverable, its workflow and the hands-on rule", note?.text);

  const H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, bundledText("workflows/v2/documents.wf.yaml")!, bundledText("workflows/v2/web-prototype.wf.yaml")!]);
  try {
    const tools = installFirstmate(H.engine, new Projects(H.data));
    const listed: any = await tools.call("studio_list_workflows", {}, { key: "t1", captain: true, text: DOC, live: () => true });
    ok(listed.routing?.deliverables?.some((d: any) => d.workflow === "documents" && /document/.test(d.asks)) && listed.routing.deliverables.some((d: any) => d.workflow === "web-prototype"), "studio_list_workflows lists which installed workflow makes each deliverable", JSON.stringify(listed.routing));
    ok(listed.routing?.thisRequest?.[0]?.workflow === "documents" && /hands-on yourself only when/.test(listed.routing.rule), "it says what this captain turn asks for and the rule", JSON.stringify(listed.routing));
    ok(!listed.routing.deliverables.some((d: any) => d.workflow === "images"), "a deliverable whose workflow is not installed is not offered");
  } finally { H.stop(); rmSync(H.data, { recursive: true, force: true }); }

  // the captain's turn carries the route; writing a deliverable file anyway is shown and reminded on the next message
  const t = await mainWith({ turnNote: (x) => routingNote(x, of), script: (text, turn) => { if (text.includes("新手三分鐘")) turn.emit({ type: "toolStart", id: "w1", name: "Write", summary: "/ws/Crew-Studio-新手三分鐘上手.md" }); } });
  try {
    const first = await t.say(DOC);
    ok(first.startsWith(DOC) && /\[Studio note: this message asks for a document, report or article → documents/.test(first), "the captain's document request reaches Firstmate with the route", first.slice(-300));
    const shown = t.m.view().log.find((l) => l.kind === "system" && /writing \/ws\/Crew-Studio-新手三分鐘上手\.md itself/.test(l.text));
    ok(!!shown && /documents workflow/.test(shown.text) && /文件|document/.test(shown.i18n?.["zh-TW"] ?? ""), "writing the document itself is shown to the captain, naming the workflow", JSON.stringify(t.m.view().log.slice(-3)));
    const next = await t.say("好");
    ok(/in your last turn you wrote \/ws\/Crew-Studio-新手三分鐘上手\.md yourself/.test(next) && /propose it on documents/.test(next), "the next captain turn reminds Firstmate to propose it", next);
    const after = await t.say("謝謝");
    ok(!/in your last turn you wrote/.test(after), "the reminder rides along once");
    const card = await t.say("card: SC-1 answered A (in Crew Studio)", "card", "desktop");
    ok(!/\[Studio note: this message asks for/.test(card), "a card notice carries no route");
  } finally { t.done(); }
  const proposed = await mainWith({ turnNote: (x) => routingNote(x, of), script: async (text, turn) => { if (text.includes("新手三分鐘")) { await turn.call("studio_propose_work", {}); turn.emit({ type: "toolStart", id: "w2", name: "Write", summary: "/ws/notes.md" }); } } });
  try {
    await proposed.say(DOC);
    ok(!proposed.m.view().log.some((l) => l.kind === "system" && /itself, but you asked/.test(l.text)), "after proposing the workflow, a file Firstmate writes is not flagged");
  } finally { proposed.done(); }
  const own = await mainWith({ turnNote: (x) => routingNote(x, of), script: (text, turn) => { turn.emit({ type: "toolStart", id: "w3", name: "Write", summary: "/ws/draft.md" }); } });
  try {
    const sent = await own.say("你自己幫我寫一份文件，存在你的工作區");
    ok(!/\[Studio note: this message asks for/.test(sent) && !own.m.view().log.some((l) => l.kind === "system" && /itself, but you asked/.test(l.text)), "a hands-on request gets no route and no flag");
  } finally { own.done(); }
});

// ---------- S5: Studio's pages come from the manual ----------
await section("S5 manual pages", async () => {
  const idx: any = studioManual(), page: any = studioManual("studio/pages");
  ok(/studio\/pages/.test(idx.text) && idx.sections.includes("studio/pages"), "the manual index lists studio/pages");
  const brief = manualSection("studio/pages", "Briefing") ?? "";
  ok(/\*\*Board\*\* \(`#\/board`[^)]*\): a task overview/.test(brief) && /no decision card, no crew on duty/.test(brief), "the Board is a task overview with no cards and no crew on duty", brief.slice(0, 300));
  ok(/\*\*Inbox\*\* \(`#\/inbox`\)[^\n]*one card at a time/.test(brief), "the Inbox shows one card at a time");
  ok(/\*\*Crew\*\* \(`#\/team`\): the Studio team/.test(brief) && /only this workflow/.test(brief), "the Crew team page is #/team, where the captain edits the team");
  ok(!!page.text && /never from memory/.test(page.text) && /never from memory/.test(manualPage("studio/firstmate") ?? "") && /studio_manual section studio\/pages, never from memory/.test(nativeFreshText("/ws")), "Firstmate is told to describe pages from the manual, not memory");
});

// ---------- S7: one captain message naming several deliverables yields one card each ----------
const THREE = "再派三個工作：1) 網頁原型：一間叫「轉角書店」的單頁網站，有營業時間、本週選書三本。2) 圖片：轉角書店的社群貼文主視覺，方形，安靜溫暖的書店角落。3) 短片：轉角書店 15 秒宣傳短片，橫式。三個都直接提出派工卡，不用再問我。";
const fixture = { id: "turn-fixture", name: "Turn fixture", version: 1, roles: [], nodes: [{ id: "wait", kind: "card", label: "Wait", x: 1, y: 1, card: { body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options: [{ id: "done", label: "Done", labelZh: "Done" }] } }, { id: "done", kind: "hook", label: "Done", x: 2, y: 1 }], edges: [{ from: "wait", to: "done", when: "done" }] };
const refusedWith = async (f: () => Promise<unknown>, re: RegExp) => { try { await f(); return false; } catch (e: any) { return re.test(String(e?.message ?? e)); } };
await section("S7 several proposals per turn", async () => {
  const H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, JSON.stringify(fixture)]); const E = H.engine;
  try {
    const tools = installFirstmate(E, new Projects(H.data));
    const owner = (key: string, text: string) => ({ key, captain: true, text, live: () => true });
    const propose = (text: string, title: string, key = "three") => tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title, text }, owner(key, THREE)) as Promise<any>;
    const web = await propose("網頁原型：一間叫「轉角書店」的單頁網站，有營業時間、本週選書三本。", "轉角書店網站");
    const image = await propose("圖片：轉角書店的社群貼文主視覺，方形，安靜溫暖的書店角落。", "轉角書店主視覺");
    const film = await propose("短片：轉角書店 15 秒宣傳短片，橫式。", "轉角書店短片");
    ok(new Set([web.proposal, image.proposal, film.proposal]).size === 3, "one message naming three deliverables yields three proposals", JSON.stringify([web, image, film]));
    await until(() => [web, image, film].every((p) => E.cards.list({ run: p.proposal }).some((c) => c.node === "dispatch")), 5000);
    ok([web, image, film].every((p) => E.cards.list({ run: p.proposal }).filter((c) => c.node === "dispatch").length === 1), "each still has its own dispatch card for the captain");
    const again = await propose("圖片：轉角書店的社群貼文主視覺，方形，安靜溫暖的書店角落。", "轉角書店主視覺");
    ok(again.proposal === image.proposal, "a retried call finds its own proposal");
    ok(await refusedWith(() => propose("A coffee shop logo with a cup and beans", "Logo"), /separate part of the captain|already has 3 proposals/), "work the captain did not name is refused");
    const two = "再派兩個：1) 網頁原型：轉角書店單頁網站，有營業時間。2) 圖片：轉角書店社群主視覺，方形。";
    const p1 = await tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title: "網站", text: "網頁原型：轉角書店單頁網站，有營業時間。" }, owner("two", two)) as any;
    ok(await refusedWith(() => tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title: "Logo", text: "A coffee shop logo with a cup and beans" }, owner("two", two)), /separate part of the captain/), "a further proposal that quotes no part of the message is refused");
    ok(!!p1.proposal && await refusedWith(() => tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title: "網站二", text: "網頁原型：轉角書店單頁網站，有營業時間和地圖。" }, owner("two", two)), /already has a proposal for this part/), "a second proposal for the same part is refused");
    const one = "Add euro formatting to the price labels";
    await tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title: "EUR", text: one }, owner("one", one));
    ok(await refusedWith(() => tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title: "EUR 2", text: "Add euro formatting to the totals" }, owner("one", one)), /already has another pinned proposal/), "a message with one deliverable still yields one proposal");
  } finally { for (const r of E.list()) if (!["succeeded", "cancelled", "failed"].includes(r.status)) await E.cancel(r.id, "fixture cleanup"); H.stop(); rmSync(H.data, { recursive: true, force: true }); }
});

// ---------- S8: approving a seat card resumes the proposal it held, also across a restart ----------
const C8 = await import("../src/domain/crew"), { installCrewGuard } = await import("../src/crew-guard"), { installCrewTools } = await import("../src/crew-tools");
const { HeldProposals } = await import("../src/firstmate-held");
const pics = { id: "fixture-pics", name: "Pictures", kind: "image", version: 1, roles: [{ id: "maker", label: "Maker", skill: "bundled:x", seat: "maker" }], seats: [{ id: "image-maker", label: "Image maker", labelZh: "圖像產出", needs: ["image-generation"], suggest: { provider: "codex" } }],
  nodes: [{ ...fixture.nodes[0], card: { ...fixture.nodes[0].card, options: [{ id: "go", label: "Go", labelZh: "Go" }] } }, { id: "draw", kind: "agent", label: "DRAW", role: "maker", mode: "test", seat: "image-maker", x: 1, y: 0 }], edges: [["wait", "draw", "go"]] };
const PICS_TEXT = "圖片：轉角書店的社群貼文主視覺，方形";
/** One Studio over `data` (a restart is a second one over the same folder): the team without an image maker, the crew tools wired as src/runtime/index.ts wires them. */
async function seatStudio(data?: string) {
  const H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, bundledText("workflows/v2/crew-change.wf.yaml")!, JSON.stringify(pics)], data ? { data } : {}); const E = H.engine;
  const facts = [{ provider: "codex", support: "supported", auth: "verified", models: [{ id: "gpt-6.1-sol", efforts: ["low", "medium", "high"] }] }];
  const m = (provider: string, model: string, effort: string | null) => ({ provider, model, effort, skills: [] });
  const store = new C8.CrewStore(H.data);
  if (!store.current()) store.write({ schema: 1, members: { coordinator: m("codex", "gpt-6.1-sol", "medium"), maker: m("codex", "gpt-6.1-sol", "medium"), "alt-maker": m("codex", "gpt-6.1-sol", "high"), reviewer: m("codex", "gpt-6.1-sol", "high") }, seats: {}, workflows: {} } as any, null, { by: "captain", via: "page" } as any);
  installCrewGuard(E, store);
  let fm: any; const told: { text: string; summary: any }[] = [];
  E.notifyFirstmate = (text, summary) => { told.push({ text, summary }); return true; };
  const crew = installCrewTools(E, store, { facts: async () => facts as any, onApproved: (run) => { void fm.resumeHeld(run).then((done: any[]) => { const n = heldNotice(run, done); if (n) E.notifyFirstmate!(n.text, n.summary); }); } });
  fm = installFirstmate(E, new Projects(H.data), { crewSeatGate: (d, o) => crew.seatGate(d, o), dispatchCrew: (d) => crew.dispatchCrew(d) });
  E.load();
  const captain = { key: "pics-turn", captain: true, text: PICS_TEXT, live: () => true };
  const propose = () => fm.call("studio_propose_work", { workflow: "fixture-pics", version: 1, title: "轉角書店主視覺", text: PICS_TEXT }, captain) as Promise<any>;
  const approveSeat = async () => { const seatRun = E.list().find((x) => x.workflow === "crew-change")!; await until(() => E.cards.list({ run: seatRun.id, open: true }).length > 0, 5000); await E.answer(E.cards.list({ run: seatRun.id, open: true })[0].id, { choice: "approve", by: "captain" } as any); return seatRun.id; };
  const proposal = async () => { await until(() => E.list().some((x) => x.workflow === "firstmate-proposal") && told.length > 0, 8000); return E.list().find((x) => x.workflow === "firstmate-proposal"); };
  const stop = async (remove = true) => { if (remove) for (const r of E.list()) if (!["succeeded", "cancelled", "failed"].includes(r.status)) await E.cancel(r.id, "fixture cleanup"); H.stop(); if (remove) rmSync(H.data, { recursive: true, force: true }); };
  return { H, E, told, propose, approveSeat, proposal, stop };
}
const heldFile = (data: string) => join(data, "firstmate", "held-proposals.json");
await section("S8 seat card resumes the held proposal", async () => {
  const S = await seatStudio(); const E = S.E;
  try {
    let refused = ""; try { await S.propose(); } catch (e: any) { refused = e.message; }
    ok(/Studio proposes this work again by itself/.test(refused), "the seat refusal says Studio proposes the work again once the seat is filled", refused);
    ok(!E.list().some((x) => x.workflow === "firstmate-proposal"), "nothing is proposed while the seat is empty");
    await S.approveSeat();
    const proposal = await S.proposal();
    ok(!!proposal && JSON.parse(proposal.params.target).text === PICS_TEXT, "approving the seat card proposes the held work again, with the captain's words", JSON.stringify({ told: S.told, runs: E.list().map((x) => `${x.id}:${x.workflow}:${x.status}`) }));
    await until(() => !!proposal && E.cards.list({ run: proposal.id }).some((c) => c.node === "dispatch"), 5000);
    ok(!!proposal && E.cards.list({ run: proposal.id }).some((c) => c.node === "dispatch" && c.status === "open"), "it waits for the captain on its own dispatch card");
    ok(S.told.some((t) => t.text.includes(proposal!.id) && /do not propose it again/.test(t.text) && /轉角書店主視覺/.test(t.summary.zh)), "Firstmate is told the seat is filled and the proposal raised");
    ok((await S.propose()).proposal === proposal!.id, "Firstmate proposing it once more finds the same proposal, never a second card");
  } finally { await S.stop(); }
});
await section("S8 held proposals survive a restart", async () => {
  const before = await seatStudio(); const data = before.H.data;
  try {
    try { await before.propose(); } catch {}
    const seatRun = before.E.list().find((x) => x.workflow === "crew-change")!.id;
    await until(() => before.E.cards.list({ run: seatRun, open: true }).length > 0, 5000);
    const saved = JSON.parse(readFileSync(heldFile(data), "utf8"));
    ok(saved.schema === 1 && saved.held[seatRun]?.[0]?.args?.text === PICS_TEXT && saved.held[seatRun][0].owner.key === "pics-turn", "the held proposal is on disk, under its seat card's Task", JSON.stringify(saved));
    ok((statSync(heldFile(data)).mode & 0o777) === 0o600 && !readdirSync(join(data, "firstmate")).some((f) => f.endsWith(".tmp")), "written whole (no temp file left), readable by Studio only");
    await before.stop(false); // Studio stops with the seat card open
    const after = await seatStudio(data);
    try {
      await after.approveSeat();
      const proposal = await after.proposal();
      ok(!!proposal && JSON.parse(proposal.params.target).text === PICS_TEXT && after.told.some((t) => t.text.includes(proposal.id)), "after the restart, approving the seat card still proposes the held work and tells Firstmate", JSON.stringify(after.E.list().map((x) => `${x.id}:${x.workflow}:${x.status}`)));
      ok(!JSON.parse(readFileSync(heldFile(data), "utf8")).held[seatRun], "a resumed proposal leaves the file");
    } finally { await after.stop(); }
  } catch (e) { rmSync(data, { recursive: true, force: true }); throw e; }
  // a seat card closed without approval drops what it held; a corrupt or missing file is no held proposals, and says so
  const dir = mkdtempSync(join(tmpdir(), "crew-held-")), warned: string[] = [];
  try {
    let open = true; const store = new HeldProposals(dir, (run) => run !== "R-1" || open, (m) => warned.push(m));
    ok(store.take("R-1").length === 0 && !warned.length, "a missing file is no held proposals, without a warning");
    store.hold("R-1", { args: { text: "a" }, owner: { key: "k", text: "a" } }); store.hold("R-1", { args: { text: "a" }, owner: { key: "k", text: "a" } });
    ok(JSON.parse(readFileSync(heldFile(dir), "utf8")).held["R-1"].length === 1, "the same captain turn and text is held once");
    open = false; store.hold("R-2", { args: { text: "b" }, owner: { key: "k2", text: "b" } });
    ok(!JSON.parse(readFileSync(heldFile(dir), "utf8")).held["R-1"] && store.take("R-1").length === 0, "a seat card that closed without approval drops what it held");
    writeFileSync(heldFile(dir), "{not json");
    ok(store.take("R-2").length === 0 && warned.some((m) => /corrupt/.test(m)), "a corrupt file is no held proposals, and the log says so", warned.join(" | "));
    store.hold("R-3", { args: { text: "c" }, owner: { key: "k3", text: "c" } });
    ok(store.take("R-3").length === 1, "holding again after a corrupt file works");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- S10: each captain turn carries the live status ----------
await section("S10 live status on every captain turn", async () => {
  const H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, JSON.stringify(fixture)]); const E = H.engine;
  try {
    const tools = installFirstmate(E, new Projects(H.data));
    const t = await mainWith({ turnNote: firstmateTurnNote(E) });
    try {
      const idle = await t.say("目前有什麼在等我？");
      ok(/\[Studio note: live status at this message: nothing waits for the captain\. Nothing is running\./.test(idle) && /never from earlier turns/.test(idle), "a captain turn says nothing waits when nothing does", idle.slice(-400));
      const p: any = await tools.call("studio_propose_work", { workflow: "turn-fixture", version: 1, title: "轉角書店網站", text: "Make the bookshop site" }, { key: "s10", captain: true, text: "Make the bookshop site", live: () => true });
      await until(() => E.cards.list({ run: p.proposal, open: true }).some((c) => c.node === "dispatch"), 5000);
      const card = E.cards.list({ run: p.proposal, open: true }).find((c) => c.node === "dispatch")!;
      const waiting = await t.say("還有什麼要我決定？");
      ok(new RegExp(`waiting for the captain: ${p.proposal} firstmate-proposal "轉角書店網站" \\(dispatch card ${card.id}`).test(waiting), "an open card is listed as waiting, with its Task and card", waiting.slice(-500));
      await E.answer(card.id, { choice: "approve", by: "captain" } as any);
      await until(() => !E.cards.list({ open: true }).some((c) => c.id === card.id) && !!E.get(p.proposal)?.ctx.childRun, 5000);
      const child = E.get(p.proposal)!.ctx.childRun as string;
      await until(() => E.cards.list({ run: child, open: true }).length > 0, 5000);
      const after = await t.say("R-080 還在等我核准嗎？");
      ok(!new RegExp(`card ${card.id}`).test(after) && new RegExp(`waiting for the captain: ${child} turn-fixture`).test(after), "once answered, the next turn no longer lists that card; the Task it started is what waits now", after.slice(-500));
      ok(/never from memory of earlier turns/.test(nativeFreshText("/ws")) && /studio_work_status read in the same turn/.test(nativeFreshText("/ws")), "Firstmate's standing text says status comes from the live line or studio_work_status in the same turn");
      const notice = await t.say("card: SC-1 answered A (in Crew Studio)", "card");
      ok(!/live status at this message/.test(notice), "a card notice carries no status line");
    } finally { t.done(); }
  } finally { for (const r of E.list()) if (!["succeeded", "cancelled", "failed"].includes(r.status)) await E.cancel(r.id, "fixture cleanup"); H.stop(); rmSync(H.data, { recursive: true, force: true }); }
});

// ---------- S23: a wake Studio writes shows the captain a summary; the raw prompt stays the turn ----------
await section("S23 escalation summary in the chat", async () => {
  const question = "Escalation at Round-budget card: 3 rounds ran and checks still fail: more rounds or a smaller scope?\nWhat is stuck: The round cap is reached after 3 rounds.";
  const shown = escalationShown({ id: "R-088", title: "新增 percent()" }, "Round-budget card", question);
  ok(/^Task R-088 “新增 percent\(\)” is stuck at Round-budget card: 3 rounds ran and checks still fail/.test(shown.en) && /Firstmate is looking at it/.test(shown.en) && !/studio_|\{task/.test(shown.en), "the escalation summary names the Task, what is stuck and that Firstmate is looking", shown.en);
  ok(/任務 R-088/.test(shown["zh-TW"]) && /卡住了/.test(shown["zh-TW"]) && /Firstmate 正在判斷/.test(shown["zh-TW"]), "and says it in Traditional Chinese", shown["zh-TW"]);
  ok(/R-061/.test(questionShown({ id: "R-061" }, "Build").en) && /Firstmate 正在回答/.test(questionShown({ id: "R-061" }, "Build")["zh-TW"]), "an agent question has its own summary");
  const t = await mainWith({});
  try {
    const raw = `Escalation in Task R-088, step budget (Round-budget card).\n${question}\nDecide with studio_answer_agent_question {task:"R-088", node:"budget", visit:1, choice:"<option id>"}`;
    const n = t.sent.length; t.m.enqueue("wake", raw, "studio-native", undefined, undefined, shown);
    const queued = t.m.view().queue.find((q) => q.kind === "wake");
    ok(!queued || queued.shown?.[raw]?.en === shown.en, "the waiting wake carries its summary for the queue view");
    await until(() => t.sent.length > n && !t.m.view().busy, 5000);
    ok(t.sent.at(-1)!.includes('studio_answer_agent_question {task:"R-088"'), "Firstmate still receives the full prompt");
    const line = t.m.view().log.filter((l) => l.kind === "wake").at(-1);
    ok(!!line && line.shown?.[0]?.en === shown.en && line.text.includes("studio_answer_agent_question"), "the chat line carries the summary; its text keeps the raw prompt for the log", JSON.stringify(line));
    t.m.enqueue("wake", "fm: task T-12 finished", "firstmate");
    await until(() => t.m.view().log.filter((l) => l.kind === "wake").length === 2, 5000);
    ok(!t.m.view().log.filter((l) => l.kind === "wake").at(-1)!.shown, "a wake firstmate wrote itself has no summary: its own line shows");
  } finally { t.done(); }
});

console.log(`firstmate-live-e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
