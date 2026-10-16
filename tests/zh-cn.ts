// 简体中文 UI (unit zh-cn): zh-CN text is the zh-TW text run through opencc-js (pinned,
// vendored to public/vendor, config twp -> cn); Studio keeps no conversion table of its
// own. displayCN keeps code, link targets, URLs and paths as written, in linear time,
// without caching a streaming reply's prefixes. The browser language picks the first-run
// language, server-provided bilingual fields convert, and model inputs keep the language
// they had.   bun tests/zh-cn.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as OpenCC from "opencc-js";
const root = join(import.meta.dir, "..");
let pass = 0, fail = 0;
const ok = (v: any, name: string, extra = "") => { if (v) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.devDependencies?.["opencc-js"] ?? pkg.dependencies?.["opencc-js"];
const vendored = join(root, "public/vendor", `opencc-js-${version}-t2cn.min.js`);
/** the vendored OpenCC and i18n.js, run as the page runs them (globalThis is the page's window) */
export function loadI18n() {
  const win: any = {};
  for (const p of [vendored, join(root, "public/i18n.js")]) { if (!existsSync(p)) return null; new Function("window", "globalThis", "self", readFileSync(p, "utf8"))(win, win, win); }
  return win;
}
/** characters that exist only in Traditional script: none may survive in a zh-CN string */
export const TRAD_ONLY = [..."著麼劃傳這們個說會時對開發體為裡與從後來還點過讓樣請機關門問題設資檔閱錄讀確認驗證狀態務頁選單號帳碼試應該無經將處動們給學實際聯絡網際線運連標準種類換單價錢費辦應變邊東車長場現見覽視訊顯開啟執絕擇隊員導覺歷識軟訊龍據術顏顯"];
const trad = (s: string) => [...s].filter((c) => TRAD_ONLY.includes(c));
const ref = OpenCC.Converter({ from: "twp", to: "cn" }); // the reference: opencc-js itself

// ---------- the tool, not a table of our own ----------
ok(/^\d+\.\d+\.\d+$/.test(String(version)), `opencc-js is pinned to an exact version (${version})`);
ok(/"opencc-js@\d/.test(readFileSync(join(root, "bun.lock"), "utf8")), "bun.lock records opencc-js");
ok(existsSync(vendored) && readFileSync(vendored).equals(readFileSync(join(root, "node_modules/opencc-js/dist/umd/t2cn.js"))), "public/vendor holds opencc-js's own browser build, byte for byte (run bun scripts/vendor-opencc.ts after a version change)");
ok(readFileSync(join(root, "public/index.html"), "utf8").includes(`<script src="/vendor/opencc-js-${version}-t2cn.min.js"></script>\n<script src="/i18n.js"></script>`), "the page loads the vendored OpenCC from Studio itself, before i18n.js (no CDN)");
ok(existsSync(join(root, "public/vendor/opencc-js-LICENSE.txt")) && /Apache License/.test(readFileSync(join(root, "public/vendor/opencc-js-LICENSE.txt"), "utf8")) && /opencc-js/.test(readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")), "the OpenCC license texts and notice ship with it");
const own = ["public/zh-cn-terms.js", "public/zh-cn-chars.js", "scripts/gen-zh-cn-chars.ts"].filter((f) => existsSync(join(root, f)));
const i18nSrc = readFileSync(join(root, "public/i18n.js"), "utf8");
ok(!own.length && !/[\u4e00-\u9fff]\s*["']?\s*[:,]\s*["'][\u4e00-\u9fff]/.test(i18nSrc.replace(/NAMES = \{[^}]*\}|cardLangs = [^\n]*/g, "")), "no conversion table of Studio's own: no term file, no generated table, no Chinese->Chinese entry in i18n.js", own.join(", "));

const w = loadI18n();
ok(w?.crewI18n && w.OpenCC, "the vendored OpenCC and public/i18n.js load in a page window");
if (w?.crewI18n) {
  const I = w.crewI18n;
  // ---------- sanity: Studio shows exactly what opencc-js outputs ----------
  const overlap = "儲存取 儲存放庫 上載入 原始檔案 原始檔名 執行檔案 執行檔名 設定檔案 設定檔名 陣列印 字元件 位元件 佇列印 回傳回 回傳送 傳回傳 傳回饋 內建立 解除安裝置 欄位元 欄位元組 欄位址 欄位數碼 命令列印 連線上 預設定檔 預設定 檢視窗 檢視訊 停用戶端 套用戶端 點選單 貼上載 分頁籤 資訊息 範本機 視訊息 音訊息 縮圖示 身分頁 重設定檔 重設定 線上載 區網路 區網域 帳本機 開檔案 開檔名 簡易檢視窗 簡易檢視訊 詳細檢視窗 詳細檢視訊 流程圖檢視窗 流程圖檢視訊".split(" ");
  const sentences = "版本機制 基本機制 原本機會 日本機場 樣本機率 根本機會 資本機構 這個版本機器上跑 數字元素 數字串 方程式 預設立場 直線上升 在線上 假設定理 一位元老 建立關係 人際互動 儲存空間 這本機器 文件夾 相互動作 共同建立 批次處理 指令碼 即時生效 公司內建立 影片檔 全文件 我們連線上 把它設定成 一則訊息 請登入帳號 下載檔案 已傳送 流程式設計 數字元件 單位元素 支援者 檔案系統 程式設計師 即時通訊 傳送門 互動式 整合測試 預設值 相容性 介面卡 記憶體不足 執行緒池 著名 顯著 著作 名著 乾坤 乾隆 看著 什麼 什么 這麼 乾淨 計畫回覆 軟體 資料夾 檔案 登入 設定 預設 介面".split(" ");
  const off = [...overlap, ...sentences].filter((s) => I.toCN(s) !== ref(s) || I.displayCN(s) !== ref(s));
  ok(!off.length, `${overlap.length} overlapping word pairs and ${sentences.length} words and sentences: toCN and displayCN equal opencc-js twp -> cn`, off.slice(0, 6).map((s) => `${s}: ${I.displayCN(s)} vs ${ref(s)}`).join(" | "));
  ok(I.toCN("請到設定頁登入你的帳號，再開啟資料夾裡的檔案。") === ref("請到設定頁登入你的帳號，再開啟資料夾裡的檔案。"), "a whole UI sentence equals opencc-js", I.toCN("請到設定頁登入你的帳號，再開啟資料夾裡的檔案。"));
  ok(I.toCN("English 不變 PR #12") === "English 不变 PR #12" && I.toCN("") === "" && I.toCN(undefined) === undefined, "Latin text, numbers, empty and missing text pass through");
  ok(I.pick("zh-CN", "Save", "儲存", "存一下") === "存一下" && I.pick("zh-CN", "Save", "儲存") === ref("儲存"), "T(en, zhTW, zhCN): an explicit zh-CN argument wins, else OpenCC's output");
  ok(I.pick("zh-TW", "Save", "儲存") === "儲存" && I.pick("en", "Save", "儲存") === "Save", "English and 繁體中文 are unchanged");
  // ---------- browser language on first run ----------
  const cases: [string[] | string, string][] = [[["zh-CN"], "zh-CN"], [["zh-SG"], "zh-CN"], [["zh-Hans"], "zh-CN"], [["zh-Hans-CN"], "zh-CN"], [["zh-TW"], "zh-TW"], [["zh-HK"], "zh-TW"],
    [["zh-Hant"], "zh-TW"], [["zh-Hant-HK"], "zh-TW"], [["en-US"], "en"], [["ja-JP"], "en"], [[], "en"], [["fr", "zh-CN"], "en"], ["zh-CN", "zh-CN"], [["zh"], "zh-CN"]];
  for (const [list, want] of cases) ok(I.browserLang(list) === want, `browser ${JSON.stringify(list)} -> ${want}`, I.browserLang(list));
  ok(I.initial("zh-CN", ["en-US"]) === "zh-CN" && I.initial("zh-TW", ["zh-CN"]) === "zh-TW" && I.initial("en", ["zh-CN"]) === "en", "a stored choice beats the browser language");
  ok(I.initial(null, ["zh-HK"]) === "zh-TW" && I.initial("klingon", ["zh-SG"]) === "zh-CN", "no (or an unknown) stored choice falls back to the browser language");
  // ---------- server-provided bilingual fields ----------
  const card = JSON.parse(readFileSync(join(root, "tests/fixture/cards/r002-dispatch.json"), "utf8"));
  const title = I.loc("zh-CN", card.title);
  ok(title && title !== card.title.en && !trad(title).length && title === ref(card.title["zh-TW"]), "a card title {en, zh-TW} converts", title);
  const sec = I.deep("zh-CN", card.sections), secText = JSON.stringify(sec);
  ok(sec && sec.why && !trad(secText).length && sec.why === ref(card.sections["zh-TW"].why), "card sections {en, zh-TW} convert, every string inside", trad(secText).join(""));
  ok(I.deep("zh-CN", card.sections) === sec, "a converted structure is reused, not rebuilt on every render");
  ok(I.loc("zh-CN", { en: "Merge", "zh-TW": "合併", "zh-CN": "合入" }) === "合入", "a server zh-CN field wins over OpenCC's output");
  ok(I.loc("zh-CN", { en: "Only English" }) === "Only English" && I.loc("zh-TW", { en: "Only English" }) === "Only English", "an English-only field falls back to English");
  ok(I.deep("zh-CN", { en: { a: 1 } })?.a === 1, "a structure with no Chinese falls back to English");
  ok(I.zhField("zh-CN", "Build loop", "建置迴圈") === ref("建置迴圈") && I.zhField("zh-TW", "Build loop", "建置迴圈") === "建置迴圈" && I.zhField("zh-CN", "Gates", "") === "Gates", "zh-TW-only fields (label_tw) convert");
  // ---------- display: what stays as written (expected = kept parts + opencc-js on the prose parts) ----------
  // each case: [input, [[piece, prose?]...], name]; the pieces concatenate to the input
  const shown: [string, [string, number][], string][] = [
    ["我改了src/app.ts的設定，", [["我改了", 1], ["src/app.ts", 0], ["的設定，", 1]], "a path ends at the Han text after it"],
    ["[這份說明](docs/a.md)", [["[這份說明]", 1], ["(docs/a.md)", 0]], "link text converts, its target does not"],
    ["見[設定](docs/設定.md)。", [["見[設定]", 1], ["(docs/設定.md)", 0], ["。", 1]], "a link target with Han stays as written (md()'s href rule)"],
    ["T-305/T-306兩個任務", [["T-305/T-306", 0], ["兩個任務", 1]], "a slash between task ids does not swallow the Han after it"],
    ["HTTP/2連線逾時", [["HTTP/2", 0], ["連線逾時", 1]], "HTTP/2 does not swallow the Han after it"],
    ["看 https://x.tw/a?b=1的設定", [["看 ", 1], ["https://x.tw/a?b=1", 0], ["的設定", 1]], "a URL ends at Han that does not continue it"],
    ["見 https://github.com/o/r/blob/main/設定.md 的說明", [["見 ", 1], ["https://github.com/o/r/blob/main/設定.md", 0], [" 的說明", 1]], "a URL whose path continues in Han after / stays as written"],
    ["改 src/設定.ts，然後登入", [["改 ", 1], ["src/設定.ts", 0], ["，然後登入", 1]], "a path whose name is Han stays as written, up to closing punctuation"],
    ["路徑 C:\\Users\\me\\設定.txt 的設定", [["路徑 ", 1], ["C:\\Users\\me\\設定.txt", 0], [" 的設定", 1]], "a Windows path stays as written"],
    ["用 `設定.js` 檔案", [["用 ", 1], ["`設定.js`", 0], [" 檔案", 1]], "inline code stays as written"],
    ["說明：\n```js\n設定 = 1\n```\n然後登入", [["說明：", 1], ["\n```js\n設定 = 1\n```\n", 0], ["然後登入", 1]], "a ``` fence stays as written"],
    ["說明：\n~~~\n設定 = 1\n~~~\n然後登入", [["說明：", 1], ["\n~~~\n設定 = 1\n~~~\n", 0], ["然後登入", 1]], "a ~~~ fence stays as written"],
    ["說明：\n\n    設定 = 1\n    還是程式碼\n\n然後登入", [["說明：\n", 1], ["\n    設定 = 1\n    還是程式碼\n\n", 0], ["然後登入", 1]], "an indented code block (after a blank line) stays as written"],
    ["第一行\n    續行的設定", [["第一行\n    續行的設定", 1]], "an indented line inside a paragraph is prose, not code"],
    ["說明\n```\n設定 = 1\n還在程式碼裡", [["說明", 1], ["\n```\n設定 = 1\n還在程式碼裡", 0]], "an unclosed fence is code to the end of the text"],
    ["見 ``` 不是圍欄 的設定", [["見 ``` 不是圍欄 的設定", 1]], "``` in the middle of a line opens no fence"],
    ["單個 ` 反引號的設定", [["單個 ` 反引號的設定", 1]], "an unclosed backtick is plain text"],
  ];
  for (const [input, pieces, name] of shown) {
    const want = pieces.map(([p, prose]) => (prose ? ref(p) : p)).join("");
    ok(pieces.map(([p]) => p).join("") === input && I.displayCN(input) === want, name, JSON.stringify([I.displayCN(input), want]));
  }
  ok(I.chatText("zh-TW", shown[0][0]) === shown[0][0] && I.chatText("en", shown[0][0]) === shown[0][0], "only 简体中文 changes a reply");
  ok(/\[\^\)\\s\]\{1,300\}/.test(readFileSync(join(root, "public/m2.js"), "utf8")) && /1-300 characters that are not "\)" or whitespace/.test(i18nSrc), "the link-target rule is md()'s href rule: [^)\\s]{1,300}");
  // ---------- linear time, cached, nothing cached while streaming ----------
  const time = (f: () => any) => { const t0 = performance.now(); const r = f(); return [r, performance.now() - t0] as const; };
  const big = "設定".repeat(20000), messy = "a/設`[x](".repeat(5000);
  let runs = ""; for (let k = 1; runs.length < 1_000_000; k++) runs += "`".repeat(k) + "設";
  const [out1, t1] = time(() => I.displayCN(big)), [, t2] = time(() => I.displayCN(messy)), [, t4] = time(() => I.displayCN(runs)), [out2, t3] = time(() => I.displayCN(big));
  ok(out1 === ref(big) && t1 < 500, `a 40,000-character Han reply converts in linear time (${t1.toFixed(0)} ms)`);
  ok(t2 < 500, `a 45,000-character reply full of slashes, backticks and brackets converts in linear time (${t2.toFixed(0)} ms)`);
  ok(t4 < 500, `a 1 MB line of backtick runs of every length 1..${runs.split("設").length - 1} converts in linear time (${t4.toFixed(0)} ms)`);
  ok(out2 === out1 && t3 < 5, `the same reply again comes from the cache (${t3.toFixed(1)} ms)`);
  const before = I.cacheSizes(), live = "正在處理設定與登入的部分。".repeat(40); let last = "";
  for (let i = 1; i <= live.length; i += 7) last = I.displayCN(live.slice(0, i), { live: true });
  const after = I.cacheSizes();
  ok(after.text === before.text && after.shown === before.shown && last === ref(live.slice(0, Math.floor((live.length - 1) / 7) * 7 + 1)), "a streaming reply converts every prefix without filling either cache", JSON.stringify([before, after]));
  // ---------- model inputs keep today's language ----------
  ok(I.modelLang("zh-CN") === "zh-TW" && I.modelLang("zh-TW") === "zh-TW" && I.modelLang("en") === "en", "model-bound language: zh-CN sends the zh-TW it sent before");
  // ---------- every zh-TW string in the UI converts cleanly ----------
  const left: string[] = [];
  for (const f of readdirSync(join(root, "public")).filter((f) => f.endsWith(".js") && f !== "i18n.js")) {
    const src = readFileSync(join(root, "public", f), "utf8");
    for (const m of src.matchAll(/["'`]([^"'`\n]*[\u4e00-\u9fff][^"'`\n]*)["'`]/g)) { const s = I.toCN(m[1]); if (s !== ref(m[1]) || trad(s).length) left.push(`${f}: ${m[1]} -> ${s}`); }
  }
  ok(!left.length, "every UI string literal equals opencc-js and keeps no Traditional-only character", left.slice(0, 5).join(" | "));
}
{
  // ---------- the status chat's suggestion chips go through T() ----------
  const m2 = readFileSync(join(root, "public/m2.js"), "utf8");
  ok(/const SUG = \(\) => \[\s*T\(/.test(m2) && !/const SUG = \(\) => zh\(\)/.test(m2), "the chat suggestion chips are T(en, zh-TW) pairs, so 简体中文 converts them");
  // ---------- interpolated server text is shown through displayCN ----------
  const m25 = readFileSync(join(root, "public/m25.js"), "utf8"), app = readFileSync(join(root, "public/app.js"), "utf8");
  ok(/const noteText = [^\n]*I18N\.displayCN\(/.test(m25) && /const toast = [^\n]*I18N\.chatText\(lang, msg\)/.test(app), "Studio notes (with ${terminal}, a wake line, a reason) and toasts show through displayCN, keeping code and paths");
  ok(/liveText = \(\) => I18N\.chatText\(lang, MS\.live, \{ live: true \}\)/.test(m25) && /requestAnimationFrame/.test(m25), "the streaming reply converts without caching, at most once per frame");
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
