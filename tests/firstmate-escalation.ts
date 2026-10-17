import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Escalations go to Firstmate first (retro 2026-10-17, finding 9; R-041 SC-072/075/079/085/102/106/112, R-061 SC-124):
// an escalation card node (args.firstmate_first) sends Firstmate the stuck question. Firstmate decides within the spec
// (the run goes on, no captain card) or escalates with its diagnosis; its silence for the bounded wait, or its absence,
// brings the card to the captain. The captain's card body is the diagnosis in captain terms, never the raw worker brief.
//   bun tests/firstmate-escalation.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
import { Engine } from "../src/runtime/engine";
const { ok, end } = suite("firstmate-escalation");
const root = join(import.meta.dir, "..");

const BRIEF = "RAW WORKER BRIEF: edit src/x.ts line 12, then rerun the lint";
const flow = Y({ id: "esc", name: "escalation fixture", version: 1, roles: [], nodes: [
  { id: "start", kind: "hook", label: "Start", do: "set", args: { key: "started", value: true }, x: 0, y: 0 },
  { id: "stuck", kind: "card", label: "Step-back card", args: { body_from: "stuck-test", card_kind: "step-back", firstmate_first: true }, x: 1, y: 0 },
  { id: "again", kind: "hook", label: "One more round", do: "set", args: { key: "again", value: true }, x: 2, y: 0 },
  { id: "rethink", kind: "hook", label: "Rescoped", do: "set", args: { key: "rescoped", value: true }, x: 2, y: 1 },
  { id: "parked", kind: "hook", label: "Parked", args: { result: "closed" }, x: 2, y: 2 },
  { id: "done", kind: "hook", label: "Done", x: 3, y: 0 }],
  edges: [["start", "stuck"], ["stuck", "again", "continue"], ["stuck", "rethink", "rescope"], ["stuck", "parked", "park"], ["again", "done"], ["rethink", "done"]] });
const H = await harness([flow]);
let E = H.engine;
const body = () => ({ title: "The same failure twice: rethink the scope or try once more?", zhTitle: "同一類失敗連續兩次：重新界定範圍，還是再試一次？",
  en: { why: "core/lint failed in two rounds in a row.", how: "Rescope, allow one more round, or park." }, zh: { why: "core/lint 連續兩輪失敗。", how: "調整範圍、再給一輪，或暫停。" },
  body: `The class lint failed twice.\n\n${BRIEF}`,
  options: [{ id: "continue", label: "One more round", labelZh: "再給一輪" }, { id: "rescope", label: "Rescope the spec", labelZh: "調整規格範圍", note: true, noteLabel: "What the new scope adds or removes" }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }] });
const asked: any[] = [];
const setAction = E.actions.set; // the harness action, for an engine made again after a restart
const install = (e: Engine) => { e.actions.set ??= setAction; e.cardBodies["stuck-test"] = body as any; e.askFirstmate = (r, node, q, visit, o) => { asked.push({ run: r.id, node: node.id, q, visit, o }); return true; }; };
install(E);
const waiting = (id: string) => E.get(id)?.status === "waiting" && !!E.get(id)?.ctx.firstmateQuestion && !E.busy(id);
const open = (id: string) => E.cards.list({ run: id, open: true });
const rejects = async (f: () => unknown) => { try { await f(); return ""; } catch (e: any) { return String(e?.message ?? e); } };

// ---------- Firstmate decides within the spec: the run goes on, no captain card ----------
{ const r = E.start({ workflow: "esc", text: "fix the lint" }); await until(() => waiting(r.id));
  const q = asked.at(-1);
  ok(!open(r.id).length && E.get(r.id)!.nodes.stuck.waiting === "firstmate" && q?.node === "stuck" && /What is stuck: core\/lint failed/.test(q.q) && JSON.stringify(q.o?.escalation?.options?.map((o: any) => o.id)) === '["continue","rescope"]',
    "an escalation goes to Firstmate first: no captain card, the node waits on Firstmate, and park (ends the run) is not offered to it", JSON.stringify([open(r.id).length, q?.o]));
  ok(!q.q.includes(BRIEF), "the notice to Firstmate states what is stuck, not the raw worker brief");
  ok(/the captain.s call/.test(await rejects(() => E.answerFromFirstmate(r.id, "stuck", { choice: "park", answer: "give up", visit: q.visit }))) && waiting(r.id), "Firstmate may not park the run: that is the captain's call");
  ok(/say why/.test(await rejects(() => E.answerFromFirstmate(r.id, "stuck", { choice: "continue", answer: " ", visit: q.visit }))), "a decision needs Firstmate's reason");
  ok(/visit/.test(await rejects(() => E.answerFromFirstmate(r.id, "stuck", { choice: "continue", answer: "env fixed", visit: q.visit + 1 }))), "a decision for another visit is refused");
  const res: any = await E.answerFromFirstmate(r.id, "stuck", { choice: "continue", answer: "I reinstalled the lint dependency; one more round will show it", visit: q.visit });
  await until(() => E.get(r.id)!.status === "succeeded");
  const run = E.get(r.id)!; const c = E.cards.get(res.card)!;
  ok(res.decided && run.ctx.again === true && !run.ctx.rescoped && c.answer?.by === "firstmate" && c.answer?.choice === "continue" && !open(r.id).length,
    "Firstmate's decision moves the run on its edge, recorded as an answered card by firstmate", JSON.stringify([res, run.status, c.answer]));
  const led = E.ledger(r.id).filter((e) => e.check === "card-answer" || (e as any).record === "card-answer");
  ok(E.events(r.id).some((e: any) => e.type === "firstmate_decided") && !(run.ctx.amendments ?? []).length, "the decision is in the run's log and never becomes a captain amendment", JSON.stringify(led.length)); }

// ---------- Firstmate escalates with its diagnosis: the captain's card is the diagnosis ----------
{ const r = E.start({ workflow: "esc", text: "fix the lint again" }); await until(() => waiting(r.id)); const q = asked.at(-1);
  const res: any = await E.answerFromFirstmate(r.id, "stuck", { escalate: "The lint rule and the captain's style guide disagree; only the captain can pick one.", recommendation: "Rescope: keep the captain's style and drop the lint rule.", visit: q.visit });
  await until(() => open(r.id).length === 1 && !E.busy(r.id));
  const c = open(r.id)[0];
  ok(res.escalated && c?.id === res.card && E.get(r.id)!.nodes.stuck.waiting === "card" && !E.get(r.id)!.ctx.firstmateQuestion, "an escalation raises the captain's card and the node waits on it", JSON.stringify([res, E.get(r.id)!.nodes.stuck.waiting]));
  ok(/What is stuck: core\/lint failed/.test(c.body) && /Firstmate's diagnosis: The lint rule/.test(c.body) && /Recommended: Rescope/.test(c.body) && !c.body.includes(BRIEF),
    "its body is what is stuck, Firstmate's diagnosis and recommendation, never the raw worker brief", c.body);
  ok(/Firstmate 的診斷/.test(c.sections["zh-TW"].why) && c.sections.en.how.startsWith("Recommended:"), "the zh-TW why names Firstmate's diagnosis; how is the recommendation");
  await E.answer(c.id, { choice: "park", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.result === "closed", "the captain may park it"); }

// ---------- Firstmate does not answer in time: the card comes to the captain, saying so ----------
{ E.firstmateAnswerMs = 300; const r = E.start({ workflow: "esc", text: "lint, slow Firstmate" });
  await until(() => open(r.id).length === 1 && !E.busy(r.id), 5000); const c = open(r.id)[0];
  ok(!!c && /did not answer within/.test(c.body) && !c.body.includes(BRIEF) && !E.get(r.id)!.ctx.firstmateQuestion, "the bounded wait: Firstmate's silence brings the card to the captain, and it says why", c?.body);
  E.firstmateAnswerMs = 15 * 60_000; }

// ---------- Firstmate is not running: straight to the captain ----------
{ const keep = E.askFirstmate; E.askFirstmate = () => false; const r = E.start({ workflow: "esc", text: "lint, no Firstmate" });
  await until(() => open(r.id).length === 1 && !E.busy(r.id)); const c = open(r.id)[0];
  ok(/Firstmate is not running/.test(c?.body ?? "") && !E.get(r.id)!.ctx.firstmateQuestion, "without Firstmate the card says so and comes at once", c?.body); E.askFirstmate = keep; }

// ---------- a restart keeps the escalation with Firstmate and sends it again ----------
{ const r = E.start({ workflow: "esc", text: "lint across a restart" }); await until(() => waiting(r.id)); const before = asked.length;
  const deps = E.deps, defs = E.defs; E = new Engine(deps, defs); install(E); E.load();
  await until(() => asked.length > before);
  ok(E.get(r.id)!.status === "waiting" && E.get(r.id)!.nodes.stuck.waiting === "firstmate" && !open(r.id).length && asked.at(-1)?.o?.escalation?.options?.length === 2,
    "after a restart the escalation still waits on Firstmate, is sent again with its options, and no captain card appears", JSON.stringify([E.get(r.id)!.status, asked.length - before]));
  const q = E.get(r.id)!.ctx.firstmateQuestion;
  await E.answerFromFirstmate(r.id, "stuck", { choice: "rescope", answer: "Limit the change to src/x.ts; the style guide covers the rest", visit: q.visit }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.ctx.rescoped === true && E.get(r.id)!.ctx.answers.stuck.by === "firstmate", "Firstmate's rescope (with its reason) moves the run after the restart", JSON.stringify([E.get(r.id)!.status, E.get(r.id)!.error, E.get(r.id)!.ctx.answers?.stuck, E.events(r.id).filter((e: any) => e.type === "log").map((e: any) => e.summary)])); }

// ---------- at most two Firstmate decisions per step: the third time is the captain's ----------
{ const loop = Y({ id: "esc-loop", name: "escalation loop", version: 1, roles: [], nodes: [
    { id: "start", kind: "hook", label: "Start", do: "set", args: { key: "n", value: 1 }, x: 0, y: 0 },
    { id: "stuck", kind: "card", label: "Step-back card", args: { body_from: "stuck-test", card_kind: "step-back", firstmate_first: true }, x: 1, y: 0 },
    { id: "rethink", kind: "hook", label: "Rescoped", do: "set", args: { key: "rescoped", value: true }, x: 2, y: 1 },
    { id: "parked", kind: "hook", label: "Parked", args: { result: "closed" }, x: 2, y: 2 }],
    edges: [["start", "stuck"], ["stuck", "stuck", "continue"], ["stuck", "rethink", "rescope"], ["stuck", "parked", "park"]] });
  const H2 = await harness([loop]); const E2 = H2.engine; E2.cardBodies["stuck-test"] = body as any; E2.askFirstmate = () => true;
  const r = E2.start({ workflow: "esc-loop", text: "loops" });
  for (let i = 0; i < 2; i++) { await until(() => E2.get(r.id)?.status === "waiting" && !!E2.get(r.id)?.ctx.firstmateQuestion && !E2.busy(r.id)); const q = E2.get(r.id)!.ctx.firstmateQuestion;
    await E2.answerFromFirstmate(r.id, "stuck", { choice: "continue", answer: `retry ${i + 1}: the flaky host is back`, visit: q.visit }); }
  await until(() => E2.cards.list({ run: r.id, open: true }).length === 1 && !E2.busy(r.id)); const c = E2.cards.list({ run: r.id, open: true })[0];
  ok(/already decided here 2 times/.test(c?.body ?? "") && !E2.get(r.id)!.ctx.firstmateQuestion, "after two Firstmate decisions at one step, the third escalation goes to the captain", c?.body);
  H2.stop(); }

// ---------- code-firstmate: its escalation cards are Firstmate-first, and their bodies carry no worker brief ----------
{ const yaml = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
  const firstmateFirst = ["step-back", "stalled", "budget", "scope-card"].every((id) => new RegExp(`id: ${id}\\n(?:.*\\n){0,4}?\\s+args: \\{[^}]*firstmate_first: true`).test(yaml));
  ok(firstmateFirst && !/id: merge-card\n(?:.*\n){0,4}?\s+args: \{[^}]*firstmate_first/.test(yaml) && !/id: dispatch\n(?:.*\n){0,3}?\s+args: \{[^}]*firstmate_first/.test(yaml), "code-firstmate's step-back, no-progress, round-budget and scope cards go to Firstmate first; dispatch and merge stay the captain's");
  const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
  const H3 = await harness([]); installCode(H3.engine, { dataDir: H3.data, projects: new Projects(H3.data) });
  const brief = { items: [{ check: "firstmate/lints", message: "src/x.ts:3 unused import" }, { check: "firstmate/covering-suites", message: "tests/x.test.ts not run" }], text: BRIEF };
  const x = (node: string, ctx: any = {}, steps: any[] = []) => ({ ctx: { spec: { title: "Fix lint", scope: ["src/x.ts"], done: ["tests/x.test.ts: passes"], zh: { title: "修正 lint", why: ["lint 失敗。"] } }, briefs: { build: brief, spec: brief }, refine: { fix: { history: [{ repeated: ["lints"] }] } }, ...ctx },
    run: { id: "R-1", title: "Fix lint", text: "Fix lint", nodes: { build: { visits: 3, data: ctx.report ? { report: ctx.report } : {} } }, steps, def: { nodes: [] } }, rn: { visits: 1 }, node: { id: node }, log() {} } as any);
  const { cardContract } = await import("../src/runtime/card-contract");
  const bodies: [string, any][] = [["budget", await H3.engine.cardBodies.budget(x("budget"))], ["stalled", await H3.engine.cardBodies.stalled(x("stalled"))], ["step-back", await H3.engine.cardBodies["step-back"](x("step-back"))],
    ["scope (SCOPE-BLOCKED)", await H3.engine.cardBodies.scope(x("scope-card", { report: { marker: "SCOPE-BLOCKED", summary: "needs src/y.ts too" } }, [{ node: "build", state: "failed", outcome: "blocked", visit: 2 }]))],
    ["scope (spec-fix cap)", await H3.engine.cardBodies.scope(x("scope-card", {}, [{ node: "spec-fix", state: "failed", outcome: "cap", visit: 3 }]))]];
  for (const [k, b] of bodies) ok(!String(b.body).includes(BRIEF) && /firstmate\/lints/.test(`${b.body} ${b.en.why}`) || (k.startsWith("scope (SCOPE") && /outside the approved scope/.test(b.en.why) && /needs src\/y\.ts/.test(b.body)),
    `code-firstmate ${k} card names what is stuck (the failing checks, or the worker's scope block), never the raw brief`, JSON.stringify([b.en.why, b.body]));
  ok(bodies.every(([, b]) => !cardContract({ title: { en: b.title, "zh-TW": b.zhTitle }, sections: { en: b.en, "zh-TW": b.zh }, body: b.body, options: b.options } as any).length),
    "every code escalation body keeps the card contract", JSON.stringify(bodies.map(([k, b]) => [k, cardContract({ title: { en: b.title, "zh-TW": b.zhTitle }, sections: { en: b.en, "zh-TW": b.zh }, body: b.body, options: b.options } as any)])));
  ok(!/The work needs a decision on the scope/.test(bodies.map(([, b]) => b.en.why).join(" ")), "the scope card no longer says the generic \"The work needs a decision on the scope\"");
  H3.engine.modelChoices = () => [{ value: "codex/gpt-5", label: "codex · gpt-5" }, { value: "claude", label: "claude · default model" }];
  const sb = await H3.engine.cardBodies["step-back"](x("step-back", { reviewUnverified: "no tests run" }));
  const other = sb.options.find((o: any) => o.id === "other-model");
  ok(other?.select?.map((s: any) => s.value).join() === "codex/gpt-5,claude" && !other.note, "the step-back card's \"another model\" is a model picker of the configured providers", JSON.stringify(other));
  H3.stop(); }

// ---------- review r1: Firstmate's decision is authorized like the captain's (provider readiness: only retry, through authorizeAnswer) ----------
{ const { ProviderRefusal } = await import("../src/providers/policy");
  const H4 = await harness([Y({ id: "ready-fm", name: "readiness via Firstmate", version: 1, roles: [{ id: "worker", label: "Worker", skill: "x" }], nodes: [
    { id: "work", kind: "agent", label: "Work", role: "worker", mode: "test", x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["work", "done", "ok"]] })]);
  const E4 = H4.engine; let providerOk = false, refuseAuth = false; const auth: any[] = [];
  E4.deps.selectProvider = async () => { if (!providerOk) throw new ProviderRefusal("provider capability identity or freshness unavailable: stub"); return E4.deps.provider("stub"); };
  E4.deps.authorizeAnswer = (_r: any, c: any, a: any) => { auth.push([c.kind, a.choice, a.by]); if (refuseAuth) throw new Error("staffing no longer verifies"); };
  const sent: any[] = []; E4.askFirstmate = (_r, _n, _q, _v, o) => { sent.push(o); return true; };
  const r = E4.start({ workflow: "ready-fm", text: "provider not ready" });
  await until(() => !!E4.get(r.id)?.ctx.firstmateQuestion && !E4.busy(r.id)); const q = E4.get(r.id)!.ctx.firstmateQuestion;
  ok(JSON.stringify(sent.at(-1)?.escalation?.options?.map((o: any) => o.id)) === '["retry"]' && !E4.cards.list({ run: r.id, open: true }).length, "a provider that is not verified asks Firstmate first, which may only prepare the round again", JSON.stringify(sent.at(-1)));
  ok(/Firstmate may choose retry/.test(await rejects(() => E4.answerFromFirstmate(r.id, "work", { choice: "close", answer: "give up", visit: q.visit }))) && /Firstmate may choose retry/.test(await rejects(() => E4.answerFromFirstmate(r.id, "work", { choice: "approve-skill", answer: "fine", visit: q.visit }))),
    "close and approve-skill are refused to Firstmate on the readiness card");
  refuseAuth = true; const refused = await rejects(() => E4.answerFromFirstmate(r.id, "work", { choice: "retry", answer: "I checked the login", visit: q.visit }));
  ok(/staffing no longer verifies/.test(refused) && auth.at(-1)?.join() === "scope,retry,firstmate" && E4.get(r.id)!.nodes.work.waiting === "firstmate" && E4.cards.list({ run: r.id }).every((c) => c.status !== "answered"),
    "Firstmate's retry goes through the same authorization as the captain's; refused, it leaves no answered card and the step still waits", JSON.stringify([refused, auth]));
  refuseAuth = false; providerOk = true; await E4.answerFromFirstmate(r.id, "work", { choice: "retry", answer: "I checked the login; the provider is back", visit: q.visit });
  await until(() => E4.get(r.id)!.status === "succeeded");
  const decided = E4.cards.list({ run: r.id }).find((c) => c.answer?.by === "firstmate");
  ok(E4.get(r.id)!.status === "succeeded" && decided?.decidedBy === "firstmate" && !decided.captainOnly, "an authorized retry prepares the round again; its card is marked as decided by Firstmate, not captain-only", JSON.stringify(decided && { d: decided.decidedBy, c: decided.captainOnly }));
  H4.stop(); }

// ---------- review r1: only escalation cards go to Firstmate; captain kinds, one-way doors and captain-only bodies come straight to the captain ----------
{ const { validate, normalize } = await import("../src/runtime/defs");
  const wf = (node: any) => normalize({ id: "v", name: "v", version: 1, roles: [], nodes: [{ id: "s", kind: "hook", label: "S", do: "set", x: 0, y: 0 }, { id: "c", kind: "card", label: "C", x: 1, y: 0, ...node }, { id: "e", kind: "hook", label: "E", x: 2, y: 0 }], edges: [["s", "c"], ["c", "e", "go"]] });
  const bad = (n: any) => validate(wf(n)).some((p) => p.level === "error" && /firstmate_first is only/.test(p.text));
  ok(["merge", "dispatch", "permission", "acceptance", "question"].every((k) => bad({ args: { card_kind: k, firstmate_first: true } })) && bad({ args: { card_kind: "step-back", firstmate_first: true, mode: "deliver-accept" } }) && bad({ do: "git.merge", args: { card_kind: "scope", firstmate_first: true } })
    && bad({ args: { card_kind: "scope", firstmate_first: true }, card: { confirm_door: true } }) && bad({ args: { card_kind: "scope", firstmate_first: true }, card: { door_from: "door" } }) && !bad({ args: { card_kind: "step-back", firstmate_first: true } }),
    "workflow validation allows firstmate_first only on a step-back, round-budget or scope card with no action, mode or door");
  let variant = "door"; const before = asked.length;
  E.cardBodies["stuck-test"] = (() => ({ ...body(), ...(variant === "door" ? { door: "one-way" } : { captainOnly: true }) })) as any;
  for (const v of ["door", "captain-only"]) { variant = v; const r = E.start({ workflow: "esc", text: `straight ${v}` }); await until(() => open(r.id).length === 1 && !E.busy(r.id));
    ok(asked.length === before && /Only the captain decides this card/.test(open(r.id)[0]?.body ?? "") && !E.get(r.id)!.ctx.firstmateQuestion, `a ${v} escalation comes straight to the captain, never to Firstmate`, open(r.id)[0]?.body); E.cancel(r.id); }
  E.cardBodies["stuck-test"] = body as any; }

// ---------- review r1: "another model" is offered to Firstmate only as picks the run accepts, never as free text ----------
{ const withModel = () => ({ ...body(), options: [{ id: "other-model", label: "Another model", labelZh: "換模型", select: [{ value: "codex/gpt-5", label: "codex" }, { value: "claude/opus", label: "claude" }] }, ...body().options] });
  E.cardBodies["stuck-test"] = withModel as any; E.firstmatePicks = () => [{ value: "claude/opus", label: "claude" }];
  const flow2 = { ...JSON.parse(flow), id: "esc-model", edges: [...JSON.parse(flow).edges, ["stuck", "again", "other-model"]] };
  const H5 = await harness([Y(flow2)]); const E5 = H5.engine; E5.actions.set ??= setAction; E5.cardBodies["stuck-test"] = withModel as any; const got: any[] = []; E5.askFirstmate = (_r, _n, _q, _v, o) => { got.push(o); return true; };
  E5.firstmatePicks = () => [{ value: "claude/opus", label: "claude" }];
  const r = E5.start({ workflow: "esc-model", text: "model swap" }); await until(() => !!E5.get(r.id)?.ctx.firstmateQuestion && !E5.busy(r.id)); const q = E5.get(r.id)!.ctx.firstmateQuestion;
  const om = got.at(-1)?.escalation?.options?.find((o: any) => o.id === "other-model");
  ok(JSON.stringify(om?.select) === '["claude/opus"]', "Firstmate is offered only the models the run accepts", JSON.stringify(om));
  ok(/pick one of claude\/opus/.test(await rejects(() => E5.answerFromFirstmate(r.id, "stuck", { choice: "other-model", answer: "codex/gpt-5", visit: q.visit }))), "a model outside the accepted picks is refused");
  E5.cancel(r.id); E5.firstmatePicks = () => [];
  const r2 = E5.start({ workflow: "esc-model", text: "no picks" }); await until(() => !!E5.get(r2.id)?.ctx.firstmateQuestion && !E5.busy(r2.id));
  ok(!got.at(-1)?.escalation?.options?.some((o: any) => o.id === "other-model"), "with no accepted pick, another model is the captain's option only");
  E5.cancel(r2.id); H5.stop(); E.cardBodies["stuck-test"] = body as any; E.firstmatePicks = () => E.modelChoices(); }

// ---------- review r1: Studio stops between Firstmate's escalation and the captain's card: the restart raises the card ----------
{ const r = E.start({ workflow: "esc", text: "crash after escalate" }); await until(() => waiting(r.id)); const before = asked.length;
  const run = E.get(r.id)!; run.nodes.stuck.data.firstmateCard.escalation = { by: "firstmate", why: "The style guide and the lint rule disagree.", recommendation: "Rescope." }; delete run.ctx.firstmateQuestion; (E as any).commit(run, "fixture: escalation recorded, card not raised");
  const deps = E.deps, defs = E.defs; E = new Engine(deps, defs); install(E); E.load();
  await until(() => open(r.id).length === 1 && !E.busy(r.id));
  ok(/Firstmate's diagnosis: The style guide and the lint rule disagree/.test(open(r.id)[0]?.body ?? "") && asked.length === before && E.get(r.id)!.nodes.stuck.waiting === "card", "a restart between Firstmate's escalation and the captain's card raises the card with the diagnosis", open(r.id)[0]?.body);
  E.cancel(r.id);
  const r2 = E.start({ workflow: "esc", text: "crash before the question" }); await until(() => waiting(r2.id)); const b2 = asked.length;
  const run2 = E.get(r2.id)!; delete run2.ctx.firstmateQuestion; (E as any).commit(run2, "fixture: question lost");
  E = new Engine(E.deps, E.defs); install(E); E.load(); await until(() => asked.length > b2 && !!E.get(r2.id)?.ctx.firstmateQuestion);
  ok(asked.length > b2 && E.get(r2.id)!.nodes.stuck.waiting === "firstmate", "a step waiting on Firstmate with no question after a restart asks Firstmate again"); E.cancel(r2.id); }

// ---------- review r1: Firstmate's change note reaches the producer as Firstmate's, never as the captain's ----------
{ const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const flag = join(mkdtempSync(join(tmpdir(), "fm-note-")), "never");
  const H6 = await harness([Y({ id: "fm-note", name: "fm note", version: 1, roles: [{ id: "maker", label: "Maker", skill: "x" }], nodes: [
    { id: "start", kind: "hook", label: "Start", do: "set", args: { key: "started", value: true }, x: 0, y: 0 },
    { id: "make", kind: "agent", label: "Make", role: "maker", mode: "test", checks: [{ use: "t/failer", params: { cls: "missing-flag", flagfile: flag } }], x: 1, y: 0 },
    { id: "fix", kind: "loop", label: "Fix", args: { producer: "make", round_cap: 1 }, x: 1, y: 1 },
    { id: "budget", kind: "card", label: "Round budget", args: { card_kind: "round-budget", firstmate_first: true }, card: { title: { en: "Checks still fail: one more round or revise?", "zh-TW": "檢查仍未通過：再一輪還是修改？" }, body: { en: "The round cap is reached.", "zh-TW": "輪數上限已到。" },
      options: [{ id: "changes", label: "Revise", labelZh: "修改", note: true }, { id: "park", label: "Park", labelZh: "暫停" }], effects: { changes: { policy: "round_cap", add: 1 } } }, x: 2, y: 1 },
    { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "parked", kind: "hook", label: "Parked", args: { result: "closed" }, x: 3, y: 1 }],
    edges: [["start", "make"], ["make", "done", "ok"], ["make", "fix", "fail"], ["fix", "make", "retry|report"], ["fix", "done", "pass"], ["fix", "budget", "cap|step-back|stalled"], ["budget", "fix", "changes"], ["budget", "parked", "park"]] })], { refine: true });
  const E6 = H6.engine; E6.askFirstmate = () => true;
  const r = E6.start({ workflow: "fm-note", text: "note attribution" }); await until(() => !!E6.get(r.id)?.ctx.firstmateQuestion && !E6.busy(r.id), 30000); const q = E6.get(r.id)!.ctx.firstmateQuestion;
  await E6.answerFromFirstmate(r.id, "budget", { choice: "changes", answer: "Write the flag file the check reads", visit: q.visit });
  await until(() => (E6.get(r.id)!.ctx.briefs?.make?.items ?? []).some((i: any) => i.source !== "check") || ["succeeded", "failed", "cancelled"].includes(E6.get(r.id)!.status), 30000);
  const items: any[] = E6.get(r.id)!.ctx.briefs?.make?.items ?? [];
  ok(items.some((i) => i.class === "firstmate-note" && /^Firstmate: Write the flag file/.test(i.message) && !/captain/.test(i.expected.replace("not the captain's word", ""))) && !items.some((i) => i.class === "captain-note") && !(E6.get(r.id)!.ctx.amendments ?? []).length,
    "Firstmate's change note reaches the producer's brief as Firstmate's (firstmate-note), never as the captain's note or amendment", JSON.stringify(items.map((i) => [i.class, i.message, i.expected])));
  if (!["succeeded", "failed", "cancelled"].includes(E6.get(r.id)!.status)) E6.cancel(r.id); H6.stop(); }

H.stop(); end();
