import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Card zh-TW quality (unit card-zh-quality): a card's zh-TW title and why are real translations the
// coordinator writes in the spec (spec.zh), never the English title behind a Chinese word or a stock
// placeholder. The STE check (core/ste-wording) refuses both; R-002's dispatch card is the fixture.
//   bun tests/card-zh.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("card-zh");
const root = join(import.meta.dir, "..");
const check = (dir: string, input: any) => { const r = Bun.spawnSync([dir.endsWith("ste-wording") ? "python3" : "node", join(root, dir, "run")], { stdin: Buffer.from(JSON.stringify(input)), stdout: "pipe", stderr: "pipe" });
  return JSON.parse(r.stdout.toString() || "{}"); };
const ste = (texts: any[]) => check("packs/core/checks/ste-wording", { params: { fail_rules: [] }, texts });
const cardTexts = (c: any) => (["en", "zh-TW"] as const).flatMap((l) => [{ section: `${l}.title`, text: c.title[l] }, { section: `${l}.intent`, text: c.sections[l].intent }, { section: `${l}.why`, text: c.sections[l].why }, { section: `${l}.how`, text: c.sections[l].how }]);

// ---------- R-002's dispatch card, as Studio raised it ----------
const r002 = JSON.parse(readFileSync(join(import.meta.dir, "fixture/cards/r002-dispatch.json"), "utf8"));
const out = ste(cardTexts(r002)); const at = (sec: string) => out.findings.filter((f: any) => f.locator?.section === sec);
ok(out.verdict === "fail" && at("zh-TW.title").some((f: any) => f.class === "ste-locale" && /is English/.test(f.message)), "R-002's zh-TW title (派工：format() supports JPY, …) is refused: English behind a Chinese word", JSON.stringify(out.findings));
ok(at("zh-TW.why").some((f: any) => f.class === "ste-locale" && /placeholder/.test(f.message)), "R-002's zh-TW why (船長要求的變更。) is refused: a placeholder, not a translation", JSON.stringify(at("zh-TW.why")));
ok(!at("zh-TW.intent").length && !at("zh-TW.how").length && !out.findings.some((f: any) => String(f.locator?.section).startsWith("en.") && f.class === "ste-locale"),
  "its real Chinese sections pass (the intent, and the how with worker / branch / reviewer kept in English); English sections are not held to the zh rule", JSON.stringify(out.findings.map((f: any) => f.locator?.section)));
const fixed = { ...r002, title: { ...r002.title, "zh-TW": "派工：format() 支援 JPY 這種沒有小數位的幣別" },
  sections: { ...r002.sections, "zh-TW": { ...r002.sections["zh-TW"], why: "有些幣別（例如日圓）沒有小數位。format() 一律把金額當成美分，所以 1235 日圓會顯示成「$12.35」：符號和數值都錯。現有呼叫只傳金額，依賴今天的美元輸出，所以預設輸出不能變。" } } };
const out2 = ste(cardTexts(fixed));
ok(!out2.findings.some((f: any) => f.class === "ste-locale"), "the same card with a translated title and why passes the zh rule", JSON.stringify(out2.findings));
ok(["TODO", "待補", "the captain asked for it", "同上。"].every((t) => ste([{ section: "zh-TW.why", text: t }]).findings.some((f: any) => /placeholder/.test(f.message))) && ste([{ section: "zh-TW.why", text: "Some currencies have no cents." }]).findings.some((f: any) => /is English/.test(f.message)),
  "every stock placeholder and a plain English sentence are refused in a zh-TW field");

// ---------- (review r1) Studio's own zh-TW card texts pass: technical terms kept in English are allowed ----------
// every Chinese string literal of the code card bodies (dispatch … merge), swept from the source so a new one is checked too
const codeSrc = readFileSync(join(root, "src/domain/code.ts"), "utf8");
const bodies = codeSrc.slice(codeSrc.indexOf("engine.cardBodies.dispatch"), codeSrc.indexOf("async function mergeCardDetail"));
// a small string-literal scanner: "…", '…' and `…` (a template's ${…} becomes a sample word), comments skipped
const literals = (src: string): string[] => { const out: string[] = []; let i = 0;
  const tpl = (): string => { let t = ""; i++; while (i < src.length && src[i] !== "`") { if (src[i] === "\\") { t += src[i + 1]; i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { let depth = 1; i += 2; while (i < src.length && depth) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; else if (src[i] === "`") { tpl(); } else if (src[i] === '"' || src[i] === "'") { const q = src[i]; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } } i++; } t += "lints"; continue; }
      t += src[i++]; } i++; return t; };
  while (i < src.length) { const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === '"' || c === "'") { let t = ""; i++; while (i < src.length && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") { t += src[i + 1]; i += 2; continue; } t += src[i++]; } i++; out.push(t); continue; }
    if (c === "`") { out.push(tpl()); continue; }
    i++; }
  return out; };
// the zh-TW how / why texts: Chinese literals that are not a title prefix ("派工：" + the title) and not the marked fallback
const zhLits = literals(bodies).filter((t) => /[\u4e00-\u9fff]/.test(t) && !/^[^。]*：lints$/.test(t) && !/（未翻譯）/.test(t));
const zhBad = zhLits.filter((t) => ste([{ section: "zh-TW.how", text: t }]).findings.some((f: any) => f.class === "ste-locale"));
ok(zhLits.includes("合併會在本地 base branch 落下一個整理過的 commit。") && zhLits.some((t) => t.startsWith("單向門：請確認門再合併。")) && zhLits.includes("worker 在自己的 branch 上做；每一輪由檢查和全新的 reviewer 判定。") && zhLits.length >= 12 && !zhBad.length,
  `Studio's own zh-TW card texts (dispatch, door, budget, step-back, stalled, scope, two-way merge: ${zhLits.length} literals) pass the zh rule with technical terms kept in English`, JSON.stringify(zhBad));
ok(ste([{ section: "zh-TW.title", text: "派工：format() supports JPY, a currency without cents" }]).findings.some((f: any) => f.class === "ste-locale" && /is English/.test(f.message)), "R-002's English title behind 派工： is still refused");
// the code-stripping pass removes only code
ok(ste([{ section: "zh-TW.title", text: "派工：Fix login" }]).findings.some((f: any) => f.class === "ste-locale" && /is English/.test(f.message)), "a short English title behind a Chinese prefix and a colon is refused (派工：Fix login)");
ok(!ste([{ section: "zh-TW.why", text: "修改src/app.ts並補上測試" }]).findings.some((f: any) => f.class === "ste-locale"), "unspaced Chinese around a path passes (修改src/app.ts並補上測試)");
ok(ste([{ section: "zh-TW.why", text: "TODO/TBD" }]).findings.some((f: any) => /placeholder/.test(f.message)), "placeholders joined by a slash are refused (TODO/TBD)");
ok(!ste([{ section: "zh-TW.why", text: "請看 `format()` 和 src/money.ts 的 a.b 呼叫" }]).findings.some((f: any) => f.class === "ste-locale"), "code, paths and calls inside Chinese still do not count as English");

// ---------- (review r1) a spec stored before zh existed (an in-flight run): the zh explain is the fallback ----------
{ const d0 = mkdtempSync(join(tmpdir(), "crew-cardzh0-"));
  const { installCode: inst } = await import("../src/domain/code"); const { Projects: P } = await import("../src/doors");
  const H0 = await harness([], { data: d0, checkRoots: [] }); inst(H0.engine, { dataDir: d0, projects: new P(d0) });
  const xOf = (spec: any) => ({ ctx: { spec }, run: { id: "R-9", title: spec.title, text: spec.what, nodes: {} }, rn: { visits: 1 }, node: { id: "dispatch" } } as any);
  const old = { title: "Show totals", what: "Show order totals", why: ["captains asked"], done: [], scope: ["src/price.js"], door: { kind: "two-way" }, explain: { en: "Totals include tax.", "zh-TW": "總額會含稅。" } };
  const b = await H0.engine.cardBodies.dispatch(xOf(old)) as any;
  ok(b.zhTitle === "派工：總額會含稅。" && b.zh.why === "總額會含稅。", "a spec without zh (stored before zh existed): the dispatch card's zh-TW title is 派工： + the zh explain, and its why is the zh explain", JSON.stringify([b.zhTitle, b.zh.why]));
  const none = await H0.engine.cardBodies.dispatch(xOf({ ...old, explain: { en: "Totals include tax." } })) as any;
  ok(none.zhTitle === "派工：Show totals（未翻譯）", "with neither zh nor a zh explain the English title is marked untranslated, never shown as a translation", JSON.stringify(none.zhTitle));
  H0.stop(); }

// ---------- the spec carries the zh title and why; spec-schema asks for them ----------
const spec = { title: "Show totals", what: "Show order totals", why: ["captains asked"], done: ["tests/price.test.mjs: total adds tax (fails on base)"], scope: ["src/price.js"], door: { kind: "two-way", reason: "code only" }, explain: { en: "Totals include tax.", "zh-TW": "總額含稅。" } };
const s1 = check("packs/firstmate/checks/spec-schema", { params: {}, artifact: { type: "spec", data: spec } });
const s2 = check("packs/firstmate/checks/spec-schema", { params: {}, artifact: { type: "spec", data: { ...spec, zh: { title: "顯示總額", why: ["船長想看到含稅的總額。"] } } } });
ok(s1.verdict === "fail" && ["zh-TW.title", "zh-TW.why"].every((sec) => s1.findings.some((f: any) => f.locator.section === sec)) && s2.verdict === "pass", "a spec without its zh-TW title and why fails spec-schema; with them it passes", JSON.stringify([s1.findings, s2.findings]));

// ---------- end to end: an English zh-TW draft goes back to the coordinator; the card shows the translation ----------
const data = mkdtempSync(join(tmpdir(), "crew-cardzh-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo"); prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data, checkRoots: [] });
const E = H.engine; installCode(E, { dataDir: data, projects: new Projects(data) });
const r = E.start({ workflow: "code-firstmate", params: {}, text: ["Add a percent function to money-kit", "STUB_ZH_ENGLISH",
  "STUB_FILE src/percent.ts :: export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n") });
await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === "dispatch") || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000);
const d = E.cards.list({ run: r.id, open: true }).find((c) => c.kind === "dispatch");
const steSpec = E.ledger(r.id).filter((e) => e.check === "core/ste-wording" && e.node === "spec");
ok(steSpec.length >= 2 && steSpec[0].verdict === "fail" && steSpec[0].findings.some((f: any) => f.class === "ste-locale" && f.locator?.section === "zh-TW.title") && steSpec[0].findings.some((f: any) => f.locator?.section === "zh-TW.why[0]") && steSpec.at(-1)!.verdict === "pass",
  "the coordinator's first draft with an English zh-TW title and a placeholder why fails the spec's STE check; the refined draft passes", JSON.stringify(steSpec.map((e) => [e.verdict, e.findings.map((f: any) => f.locator?.section)])));
await until(() => !!E.cards.get(d?.id ?? "")?.ste, 20000);
const dc = d ? E.cards.get(d.id)! : null;
ok(!!dc && dc.title["zh-TW"] === "派工：依照意圖修改程式碼並補上測試" && /船長在意圖裡寫了要的結果/.test(dc.sections["zh-TW"].why) && !/船長要求的變更/.test(JSON.stringify(dc.sections["zh-TW"])) && dc.ste?.verdict === "pass",
  "the dispatch card's zh-TW title and why are the coordinator's translation, and the card's STE check passes", JSON.stringify([dc?.title, dc?.sections["zh-TW"].why, dc?.ste]));
E.cancel(r.id, "captain"); H.stop();
end();
