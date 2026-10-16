// 简体中文 UI (unit zh-cn): zh-CN text is derived from zh-TW through the reviewed
// conversion table (public/zh-cn-terms.js, then OpenCC's characters in
// public/zh-cn-chars.js), explicit overrides win, the browser language picks the
// first-run language, server-provided bilingual fields convert, and model inputs
// keep the language they had.   bun tests/zh-cn.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
let pass = 0, fail = 0;
const ok = (v: any, name: string, extra = "") => { if (v) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
/** the three browser files, run as the page runs them, against one window */
export function loadI18n(extra: Record<string, any> = {}) {
  const win: any = { ...extra };
  for (const f of ["zh-cn-chars.js", "zh-cn-terms.js", "i18n.js"]) {
    const p = join(root, "public", f); if (!existsSync(p)) return null;
    new Function("window", readFileSync(p, "utf8"))(win);
  }
  return win;
}
/** characters that exist only in Traditional script: none may survive in a zh-CN string */
export const TRAD_ONLY = [..."著麼劃傳這們個說會時對開發體為裡與從後來還點過讓樣請機關門問題設資檔閱錄讀確認驗證狀態務頁選單號帳碼試應該無經將處動們給學實際聯絡網際線運連標準種類換單價錢費辦應變邊東車長場現見覽視訊顯開啟執絕擇隊員導覺歷識軟訊龍據術顏顯"];
const trad = (s: string) => [...s].filter((c) => TRAD_ONLY.includes(c));

const w = loadI18n();
ok(w?.crewI18n, "public/i18n.js, zh-cn-terms.js and zh-cn-chars.js load in a page window");
if (w?.crewI18n) {
  const I = w.crewI18n;
  // ---------- the conversion table ----------
  const terms: [string, string][] = [["軟體", "软件"], ["資料夾", "文件夹"], ["檔案", "文件"], ["登入", "登录"], ["設定", "设置"], ["預設", "默认"], ["介面", "界面"]];
  for (const [tw, cn] of terms) ok(I.toCN(tw) === cn, `term ${tw} -> ${cn}`, I.toCN(tw));
  ok(I.toCN("請到設定頁登入你的帳號，再開啟資料夾裡的檔案。") === "请到设置页登录你的账号，再打开文件夹里的文件。", "a sentence: terms and characters in one pass", I.toCN("請到設定頁登入你的帳號，再開啟資料夾裡的檔案。"));
  ok(I.toCN("程式碼") === "代码" && I.toCN("程式") === "程序", "the longest term wins (程式碼 is not 程序碼)");
  ok(I.toCN("檔案文件") === "文件文档", "one pass: a converted term is never converted again (檔案 -> 文件 stays 文件)");
  ok(I.toCN("計畫回覆") === "计划回复", "OpenCC's exception phrases apply (計畫, 回覆)");
  ok(I.toCN("English 不變 PR #12") === "English 不变 PR #12", "Latin text, numbers and punctuation pass through");
  ok(I.toCN("") === "" && I.toCN(undefined) === undefined, "empty and missing text stay as they are");
  // ---------- overrides ----------
  const w2 = loadI18n({ crewZhTerms: undefined });
  const terms2 = readFileSync(join(root, "public/zh-cn-terms.js"), "utf8");
  ok(/overrides:\s*\{/.test(terms2), "zh-cn-terms.js has an overrides table");
  const wo: any = {}; new Function("window", readFileSync(join(root, "public/zh-cn-chars.js"), "utf8"))(wo);
  wo.crewZhTerms = { terms: { "設定": "设置" }, overrides: { "設定完成": "已经配置好了" } };
  new Function("window", readFileSync(join(root, "public/i18n.js"), "utf8"))(wo);
  ok(wo.crewI18n.toCN("設定完成") === "已经配置好了" && wo.crewI18n.toCN("設定") === "设置", "an exact-string override replaces the derived text; other strings still derive");
  ok(I.pick("zh-CN", "Save", "儲存", "存一下") === "存一下" && I.pick("zh-CN", "Save", "儲存") === "保存", "T(en, zhTW, zhCN): an explicit zh-CN argument wins, else it derives");
  ok(I.pick("zh-TW", "Save", "儲存") === "儲存" && I.pick("en", "Save", "儲存") === "Save", "English and 繁體中文 are unchanged");
  ok(w2?.crewI18n, "i18n.js still loads without the terms file");
  // ---------- browser language on first run ----------
  const cases: [string[] | string, string][] = [[["zh-CN"], "zh-CN"], [["zh-SG"], "zh-CN"], [["zh-Hans"], "zh-CN"], [["zh-Hans-CN"], "zh-CN"], [["zh-TW"], "zh-TW"], [["zh-HK"], "zh-TW"],
    [["zh-Hant"], "zh-TW"], [["zh-Hant-HK"], "zh-TW"], [["en-US"], "en"], [["ja-JP"], "en"], [[], "en"], [["fr", "zh-CN"], "en"], ["zh-CN", "zh-CN"], [["zh"], "zh-CN"]];
  for (const [list, want] of cases) ok(I.browserLang(list) === want, `browser ${JSON.stringify(list)} -> ${want}`, I.browserLang(list));
  ok(I.initial("zh-CN", ["en-US"]) === "zh-CN" && I.initial("zh-TW", ["zh-CN"]) === "zh-TW" && I.initial("en", ["zh-CN"]) === "en", "a stored choice beats the browser language");
  ok(I.initial(null, ["zh-HK"]) === "zh-TW" && I.initial("klingon", ["zh-SG"]) === "zh-CN", "no (or an unknown) stored choice falls back to the browser language");
  // ---------- server-provided bilingual fields ----------
  const card = JSON.parse(readFileSync(join(root, "tests/fixture/cards/r002-dispatch.json"), "utf8"));
  const title = I.loc("zh-CN", card.title);
  ok(title && title !== card.title.en && !trad(title).length && title === I.toCN(card.title["zh-TW"]), "a card title {en, zh-TW} converts", title);
  const sec = I.deep("zh-CN", card.sections);
  const secText = JSON.stringify(sec);
  ok(sec && sec.why && !trad(secText).length && sec.why === I.toCN(card.sections["zh-TW"].why), "card sections {en, zh-TW} convert, every string inside", trad(secText).join(""));
  ok(I.deep("zh-CN", card.sections) === sec, "a converted structure is reused, not rebuilt on every render");
  ok(I.loc("zh-CN", { en: "Merge", "zh-TW": "合併", "zh-CN": "合入" }) === "合入", "a server zh-CN field wins over the derived text");
  ok(I.loc("zh-CN", { en: "Only English" }) === "Only English" && I.loc("zh-TW", { en: "Only English" }) === "Only English", "an English-only field falls back to English");
  ok(I.deep("zh-CN", { en: { a: 1 } })?.a === 1, "a structure with no Chinese falls back to English");
  ok(I.zhField("zh-CN", "Build loop", "建置迴圈") === "建置循环" && I.zhField("zh-TW", "Build loop", "建置迴圈") === "建置迴圈" && I.zhField("zh-CN", "Gates", "") === "Gates", "zh-TW-only fields (label_tw) convert");
  // ---------- model replies: display-time conversion leaves code, links and paths alone ----------
  const reply = "這個檔案 `程式碼.js`：\n```\n設定 = 1\n```\n見 [設定頁](#/settings) https://x.tw/設定 ./資料/設定.md src/設定.ts，然後登入。";
  ok(I.displayCN(reply) === "这个文件 `程式碼.js`：\n```\n設定 = 1\n```\n见 [设置页](#/settings) https://x.tw/设置 ./资料/设置.md src/设置.ts，然后登录。", "a reply converts for display; fenced code, inline code and link targets stay as written; a URL or path ends at Han", I.displayCN(reply));
  ok(I.chatText("zh-TW", reply) === reply && I.chatText("en", reply) === reply && I.chatText("zh-CN", reply) === I.displayCN(reply), "only 简体中文 converts a reply");
  ok(I.toCN("ab") === "ab" && reply.includes("設定"), "the stored reply itself is never changed");
  // ---------- OpenCC phrases that block a character change, and text that is already Simplified ----------
  const fixed: [string, string][] = [["著名", "著名"], ["顯著", "显著"], ["著作", "著作"], ["名著", "名著"], ["乾坤", "乾坤"], ["乾隆", "乾隆"], ["看著", "看着"], ["什麼", "什么"], ["什么", "什么"], ["這麼", "这么"], ["乾淨", "干净"]];
  for (const [tw, cn] of fixed) ok(I.toCN(tw) === cn, `phrase ${tw} -> ${cn}`, I.toCN(tw));
  ok(I.toCN("这是简体：什么、怎么、为什么，已经是简体了。") === "这是简体：什么、怎么、为什么，已经是简体了。", "already-Simplified text is left as it is (么 never becomes 幺)", I.toCN("这是简体：什么、怎么、为什么，已经是简体了。"));
  // ---------- display-time conversion: what stays as written ----------
  const shown: [string, string, string][] = [
    ["我改了src/app.ts的設定，", "我改了src/app.ts的设置，", "a path stops at the Han text after it"],
    ["[這份說明](docs/a.md)", "[这份说明](docs/a.md)", "link text converts, its target does not"],
    ["見[設定](docs/設定.md)。", "见[设置](docs/設定.md)。", "a link target with Han stays as written"],
    ["T-305/T-306兩個任務", "T-305/T-306两个任务", "a slash between task ids does not swallow the Han after it"],
    ["HTTP/2連線逾時", "HTTP/2连接超时", "HTTP/2 does not swallow the Han after it"],
    ["看 https://x.tw/a?b=1的設定", "看 https://x.tw/a?b=1的设置", "a URL stops at Han"],
    ["路徑 C:\\Users\\me\\a.txt 的設定", "路径 C:\\Users\\me\\a.txt 的设置", "a Windows path stays, the Han around it converts"],
    ["用 `設定.js` 檔案", "用 `設定.js` 文件", "inline code stays as written"],
    ["說明：\n```js\n設定 = 1\n```\n然後登入", "说明：\n```js\n設定 = 1\n```\n然后登录", "a ``` fence stays as written"],
    ["說明：\n~~~\n設定 = 1\n~~~\n然後登入", "说明：\n~~~\n設定 = 1\n~~~\n然后登录", "a ~~~ fence stays as written"],
    ["說明：\n\n    設定 = 1\n    還是程式碼\n\n然後登入", "说明：\n\n    設定 = 1\n    還是程式碼\n\n然后登录", "an indented code block (after a blank line) stays as written"],
    ["第一行\n    續行的設定", "第一行\n    续行的设置", "an indented line inside a paragraph is prose, not code"],
    ["說明\n```\n設定 = 1\n還在程式碼裡", "说明\n```\n設定 = 1\n還在程式碼裡", "an unclosed fence is code to the end of the text"],
    ["見 ``` 不是圍欄 的設定", "见 ``` 不是围栏 的设置", "``` in the middle of a line opens no fence"],
    ["單個 ` 反引號的設定", "单个 ` 反引号的设置", "an unclosed backtick is plain text"],
  ];
  for (const [tw, cn, name] of shown) ok(I.displayCN?.(tw) === cn, name, JSON.stringify(I.displayCN?.(tw)));
  // ---------- linear time, cached ----------
  const big = "設定".repeat(20000), messy = "a/設`[x](".repeat(5000);
  let t0 = performance.now(); const out1 = I.displayCN?.(big); const t1 = performance.now() - t0;
  t0 = performance.now(); I.displayCN?.(messy); const t2 = performance.now() - t0;
  t0 = performance.now(); const out2 = I.displayCN?.(big); const t3 = performance.now() - t0;
  ok(out1 === "设置".repeat(20000) && t1 < 400, `a 40,000-character Han reply converts in linear time (${t1.toFixed(0)} ms)`);
  ok(t2 < 400, `a 40,000-character reply full of slashes, backticks and brackets converts in linear time (${t2.toFixed(0)} ms)`);
  ok(out2 === out1 && t3 < 5, `the same reply again comes from the cache (${t3.toFixed(1)} ms)`);
  // ---------- wording ----------
  for (const [tw, cn] of [["證據帳本", "证据账本"], ["這裡顯示 6 位數碼", "这里显示 6 位数字"], ["瀏覽器會自己開檔。", "浏览器会自己打开文件。"]]) ok(I.toCN(tw) === cn, `wording ${tw} -> ${cn}`, I.toCN(tw));
  // ---------- model inputs keep today's language ----------
  ok(I.modelLang("zh-CN") === "zh-TW" && I.modelLang("zh-TW") === "zh-TW" && I.modelLang("en") === "en", "model-bound language: zh-CN sends the zh-TW it sent before");
  // ---------- every zh-TW string in the UI converts cleanly ----------
  const left: string[] = [];
  for (const f of ["app.js", "backbone.js", "m2.js", "m25.js", "takeover.js", "ootb.js", "runtime.js", "scard.js", "board.js", "onboarding.js"]) {
    const src = readFileSync(join(root, "public", f), "utf8");
    for (const m of src.matchAll(/["'`]([^"'`\n]*[一-鿿][^"'`\n]*)["'`]/g)) { const s = I.toCN(m[1]); const t = trad(s); if (t.length) left.push(`${f}: ${m[1]} -> ${s}`); }
  }
  ok(!left.length, "no Traditional-only character survives conversion of any UI string literal", left.slice(0, 5).join(" | "));
}
{
  // ---------- the status chat's suggestion chips go through T() ----------
  const m2 = readFileSync(join(root, "public/m2.js"), "utf8");
  ok(/const SUG = \(\) => \[\s*T\(/.test(m2) && !/const SUG = \(\) => zh\(\)/.test(m2), "the chat suggestion chips are T(en, zh-TW) pairs, so 简体中文 converts them");
  // ---------- the chat's Studio notes are bilingual ----------
  const main = readFileSync(join(root, "src/host/main.ts"), "utf8");
  // every status/system note the chat can show carries both languages; a Codex/fresh "statement" (filtered out of the
  // chat), a native tool failure (rendered from its own {en, zh-TW} reason) and a typed external error (rendered by
  // externalView from its own {en, zh-TW} reason) are the exceptions
  const notes = main.split("this.note(").slice(1).map((c) => c.slice(0, 700).split("});")[0]).filter((c) => /^\{\s*kind: "(status|system)"/.test(c));
  const englishOnly = notes.filter((l) => !/\bbi\(|i18n/.test(l) && !/text: statement|nativeFailure|external: /.test(l));
  ok(notes.length >= 12 && !englishOnly.length, `Studio's ${notes.length} status/system notes in the Firstmate chat carry an i18n {en, zh-TW} field (incl. Claude permission mode, auto-mode rules)`, englishOnly.map((l) => l.trim().slice(0, 90)).join(" | "));
  ok(/claudeModeLineZh/.test(main) && /auto mode 規則/.test(main), "the Claude permission-mode and auto-mode-rules notes have their zh-TW line");
}
console.log(`\nzh-cn: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
