import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The live E2E's Firstmate findings (scratchpad e2e-sandbox.md), each with what the captain wants to see:
//  S3  "幫我寫一份文件…" is a Documents proposal, not a file Firstmate writes itself: studio_list_workflows routes each
//      deliverable, the captain turn carries the route, and writing a deliverable file anyway is shown and reminded.
// No model is called: a fake in-process host stands in for the CLI, and the tools run on the real engine.
//      bun tests/firstmate-live-e2e.ts
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, until } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { installFirstmate } from "../src/firstmate";
import { Projects } from "../src/doors";
import { deliverableKinds, routeRequest } from "../src/deliverables";
import { routingNote } from "../src/firstmate-turn";
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

console.log(`firstmate-live-e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
