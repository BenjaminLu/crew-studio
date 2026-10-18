import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Firstmate's proposals (E2E F2, F7, F8, F9): a Task gets a short title for the board while its intent keeps the
// captain's full request; a proposal whose text restates the approved staffing is refused with the sentence to
// remove; the dispatch card lists parameters as key/value lines and keeps Studio's internal _-prefixed pins apart;
// a captain turn written in Traditional Chinese tells Firstmate so (opencc-js decides, no table of Studio's own).
//      bun tests/firstmate-intent-title.ts
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { harness, until } from "./rt-harness";
import { installFirstmate, staffingInIntent } from "../src/firstmate";
import { Projects } from "../src/doors";
import { clampTitle, deriveTitle, titleWidth, taskTitle } from "../src/task-title";
import { captainScript, withScriptNote, TRADITIONAL_NOTE, LANGUAGE_NOTE } from "../src/captain-script";
import { nativeFreshText, REPLY_LANGUAGE } from "../src/host/main";
process.env.CREW_TEST_IN_PROCESS = "1";
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : " " + extra}`); v ? pass++ : fail++; };
// R-058's intent, as Firstmate wrote it
const R058 = '在 money-kit (sandbox) 專案（基準 main）為 format() 新增歐元 EUR 顯示：金額以分（cents）為單位，例如 format(123456, "EUR") 應輸出 "€1.234,56"。並讓 Corner Shop 頁面可切換以歐元顯示價格。需有在 main 上會失敗的測試證明 EUR 格式；不得破壞既有幣別格式。使用已核准 R-056 人員配置：四角色 Codex/gpt-6.1-sol/low 及各自固定原生技能。';
const REQUEST = R058.slice(0, R058.indexOf("使用已核准"));

// ---- F8: titles ----
ok(deriveTitle(REQUEST) === "在 money-kit 專案為 format 新增歐元 EUR 顯示" && titleWidth(deriveTitle(REQUEST)) <= 48, "a long request derives a short first-clause title, aside dropped", deriveTitle(REQUEST));
ok(clampTitle("工".repeat(40)) === "工".repeat(23) + "…", "an over-long title is clamped to 24 CJK characters with …");
ok(taskTitle({ title: R058, text: R058 }) === deriveTitle(R058), "a run recorded with the whole request as title shows a derived one on read");

// ---- F7: staffing in the intent ----
ok(staffingInIntent(R058) === "使用已核准 R-056 人員配置：四角色 Codex/gpt-6.1-sol/low 及各自固定原生技能。", "the staffing sentence in R-058's intent is found", String(staffingInIntent(R058)));
// the captain's own words are never refused, even when they talk about staffing with a concrete model or card
const OWN = ["Fix the staffing card so an approved crew shows its providers.", "R-041 follow-up: the staffing interview crashes when codex/gpt-5 is unverified.",
  "approved R-041 follow-up: make the staffing defaults prefer medium effort", "修正人員配置卡：已核准後仍顯示舊的模型。", "Make the Claude staffing defaults use claude/opus."];
ok(OWN.every((t) => staffingInIntent(t, t) === null), "the captain's own staffing requests pass when they are the captain's words", JSON.stringify(OWN.map((t) => staffingInIntent(t, t))));
ok(staffingInIntent(R058, REQUEST) !== null, "R-058's sentence, which the captain never wrote, is still found");
ok(staffingInIntent(REQUEST) === null && staffingInIntent("Show the Claude staffing defaults on the board.") === null, "a request without a restated crew passes, even one about staffing as a feature");

// ---- F2: the captain's script ----
ok(captainScript("已批准配置卡，請提交派工卡") === "traditional" && captainScript("我已经把默认配置记下来") === "chinese" && captainScript("approved, please propose") === null, "Traditional Chinese is told apart through opencc-js");
const JA = "日本語の文章です。設定を確認してください";
ok(captainScript(JA) === null && withScriptNote(JA, JA) === `${JA}\n\n${LANGUAGE_NOTE}`, "Japanese (kana) gets only the language rule, no Traditional note, though opencc-js would change its kanji");
ok(withScriptNote("fix the bug in 台灣 build", "fix the bug in 台灣 build").endsWith(TRADITIONAL_NOTE) && /when you reply in Chinese, use Traditional/.test(TRADITIONAL_NOTE) && !/Reply in Traditional/.test(TRADITIONAL_NOTE), "English with a Traditional proper noun gets a note that only binds a Chinese reply");
// every captain turn after the greeting carries the conversation-language rule (the Board's language set only the greeting)
ok(/reply in the language and script the captain writes in/.test(LANGUAGE_NOTE) && /titles/.test(LANGUAGE_NOTE), "the language rule follows the captain's language and script, titles included");
ok(withScriptNote("我已经把默认配置记下来", "我已经把默认配置记下来") === `我已经把默认配置记下来\n\n${LANGUAGE_NOTE}`, "a Simplified captain gets the language rule and no Traditional note");
ok(withScriptNote("1，用預設配置", "1，用預設配置") === `1，用預設配置\n\n${LANGUAGE_NOTE} ${TRADITIONAL_NOTE}` && withScriptNote("use defaults", "use defaults") === `use defaults\n\n${LANGUAGE_NOTE}`, "a Traditional Chinese turn carries the rule and the Traditional note; an English one the rule only");
// Studio never converts Firstmate's text: the captain's own words go out unchanged, before the note
ok(withScriptNote("我已经把默认配置记下来", "我已经把默认配置记下来").startsWith("我已经把默认配置记下来\n\n"), "the captain's words are sent as written (no conversion)");
for (const [loc, name] of [["en", "English"], ["zh-TW", "Traditional Chinese \\(繁體中文\\)"], ["zh-CN", "Simplified Chinese \\(简体中文\\)"]] as const)
  ok(new RegExp(`^The captain’s current dashboard language is ${name}\\. Greet the captain in ${name}\\.`).test(nativeFreshText("/tmp/ws", undefined, loc)), `the greeting turn names the Board's language (${loc})`);
ok(/first message uses the Board's language; afterwards, the captain's language and script/.test(readFileSync(new URL("../workflows/skills/firstmate-workflow-design/SKILL.md", import.meta.url), "utf8")), "Firstmate's skill says: first message in the Board's language, then the captain's language and script");
const seed = nativeFreshText("/tmp/ws", undefined, "zh-CN");
ok(seed.includes(REPLY_LANGUAGE) && !/converse in Simplified/.test(seed) && /Greet the captain in Simplified Chinese/.test(seed), "the seed names the dashboard language for the greeting only, and the captain's script for every reply");
ok(/text is only the captain's request/.test(seed) && /Never put staffing/.test(seed), "the seed tells Firstmate the intent is only the captain's request");

// ---- the real proposal path ----
const flow = { id: "title-fixture", name: "Title fixture", version: 1, roles: [], params: { mode: { label: "Mode" } }, nodes: [{ id: "done", kind: "hook", label: "Done" }], edges: [] };
const H = await harness([readFileSync(new URL("../workflows/v2/firstmate-proposal.wf.yaml", import.meta.url), "utf8"), JSON.stringify(flow)]); const E = H.engine;
const tools = installFirstmate(E, new Projects(H.data));
const owner = (key: string) => ({ key, captain: true, text: REQUEST, live: () => true });
const refusal = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e: any) { return e; } };
try {
  const spec = tools.specs.find((s: any) => s.name === "studio_propose_work") as any;
  ok(spec.inputSchema.properties.title && /captain's request only/.test(spec.inputSchema.properties.text.description) && /staffing/.test(spec.inputSchema.properties.text.description), "studio_propose_work asks for a title and says text is only the captain's request");
  const staffed = await refusal(() => tools.call("studio_propose_work", { workflow: "title-fixture", version: 1, title: "EUR 金額格式", text: R058 }, owner("staffed")));
  ok(staffed?.publicFailure?.code === "invalid_params" && String(staffed.message).includes("使用已核准 R-056") && !E.list().length, "a proposal that restates the approved crew in its text is refused before any Task, naming the sentence", String(staffed?.message));
  for (const [k, t] of OWN.entries()) { const r = await refusal(() => tools.call("studio_propose_work", { workflow: "title-fixture", version: 1, title: "Staffing fix", text: t }, { key: "own-" + k, captain: true, text: t, live: () => true }));
    ok(r === null, `the captain's own words propose: ${t}`, String(r?.message)); }
  ok((await refusal(() => tools.call("studio_propose_work", { workflow: "title-fixture", version: 1, title: "依據 /Users/you/brief.pdf", text: REQUEST }, owner("path"))))?.publicFailure?.code === "invalid_params", "a title with a path is refused");
  const p: any = await tools.call("studio_propose_work", { workflow: "title-fixture", version: 1, title: "EUR 金額格式", text: REQUEST, params: { mode: "fast" } }, owner("titled"));
  const proposal = E.get(p.proposal)!;
  ok(proposal.title === "EUR 金額格式" && proposal.text === REQUEST, "Firstmate's title names the proposal Task; the request is kept whole", proposal.title);
  await until(() => E.cards.list({ run: proposal.id }).some((c) => c.node === "dispatch"));
  const card = E.cards.list({ run: proposal.id }).find((c) => c.node === "dispatch")!;
  ok(card.sections.en.intent === REQUEST, "the dispatch card's intent is the captain's full request");
  ok(/Parameters \/ 參數:\n {2}mode: fast\n/.test(card.body) && !card.body.includes('{"mode"'), "F9: the dispatch card lists parameters as key/value lines, not JSON", card.body);
  await E.answer(card.id, { choice: "approve", by: "captain" } as any);
  await until(() => E.list().some((r) => r.params._firstmateProposal === proposal.id));
  const child = E.list().find((r) => r.params._firstmateProposal === proposal.id)!;
  ok(child.title === "EUR 金額格式" && child.text === REQUEST, "the approved work starts under Firstmate's short title with the full request", child?.title);
  const untitled: any = await tools.call("studio_propose_work", { workflow: "title-fixture", version: 1, text: REQUEST }, owner("untitled"));
  ok(E.get(untitled.proposal)!.title === deriveTitle(REQUEST), "without a title one is derived from the request, never the whole sentence", E.get(untitled.proposal)!.title);
  // a proposal pinned with an internal param (code-firstmate pins _staffing this way): the card keeps it out of the parameters
  const hash = (v: any): string => createHash("sha256").update(stable(v)).digest("hex");
  function stable(v: any): string { return v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}" : JSON.stringify(v); }
  const pin = "c89c8e781426d0af49059d9ae785ffd44f26e401a82edd9cb4e3daf48645ba45";
  const pinned = E.start({ workflow: "firstmate-proposal", version: E.defs.get("firstmate-proposal")!.version, text: REQUEST, by: "fixture", params: { source: "pinned", definition: hash(E.defs.get("title-fixture", 1)), project: hash(null),
    target: JSON.stringify({ workflow: "title-fixture", version: 1, text: REQUEST, params: { mode: "fast", _staffing: pin } }) } });
  await until(() => E.cards.list({ run: pinned.id }).some((c) => c.node === "dispatch"));
  const pc = E.cards.list({ run: pinned.id }).find((c) => c.node === "dispatch")!;
  const head = pc.body.split("Internal pins / 內部鎖定:")[0];
  ok(!!pc && !head.includes(pin) && !head.includes("_staffing") && pc.body.endsWith(`Internal pins / 內部鎖定:\n  _staffing: ${pin}`), "F9: an internal _ pin stays out of the parameters and sits last under Internal pins", pc?.body);
  ok(!pc.sections.en.scope.in.some((s: string) => s.startsWith("_")) && pc.sections.en.scope.in.includes("mode: fast"), "F9: the card's scope lists the declared params only", JSON.stringify(pc.sections.en.scope.in));
} finally { for (const r of E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) await E.cancel(r.id); H.stop(); }
console.log(`\nfirstmate-intent-title: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
