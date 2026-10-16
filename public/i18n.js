// The UI languages: English, 繁體中文 (zh-TW) and 简体中文 (zh-CN). zh-CN is never a
// third hand-written copy and Studio keeps no conversion table of its own: zh-CN text
// is the zh-TW text run through OpenCC (opencc-js, served from /vendor, config
// "twp" -> "cn": Taiwan phrases to Mainland, e.g. 軟體 -> 软件, 登入 -> 登录). Whatever
// OpenCC outputs is what the page shows. Every language branch in the UI goes through
// pick / loc / deep / zhField, so a zh-CN field from the server, or T()'s third
// argument, wins where present. Model inputs keep the language they had before zh-CN
// existed: modelLang().
(() => {
  const LANGS = ["en", "zh-TW", "zh-CN"];
  // without the vendored OpenCC (a page that loads this file alone) zh-CN shows the zh-TW text unchanged
  const convert = window.OpenCC?.Converter ? window.OpenCC.Converter({ from: "twp", to: "cn" }) : (s) => s;
  const memo = new Map();
  /** zh-TW text -> zh-CN text through OpenCC. live: true converts without remembering (a streaming reply's prefixes). */
  function toCN(s, o) {
    if (typeof s !== "string" || !s) return s;
    if (o?.live) return memo.get(s) ?? convert(s);
    const hit = memo.get(s); if (hit !== undefined) return hit;
    const out = convert(s);
    if (memo.size > 5000) memo.clear();
    memo.set(s, out); return out;
  }
  const deepMemo = new WeakMap();
  /** every string in a zh-TW object or array converted; keys are kept */
  function deepCN(v) {
    if (typeof v === "string") return toCN(v);
    if (!v || typeof v !== "object") return v;
    const hit = deepMemo.get(v); if (hit) return hit;
    const out = Array.isArray(v) ? v.map(deepCN) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepCN(x)]));
    deepMemo.set(v, out); return out;
  }
  const norm = (l) => (LANGS.includes(l) ? l : "en");
  /** the first preferred browser language: zh / zh-CN / zh-SG / zh-Hans -> zh-CN; zh-TW / zh-HK / zh-Hant -> zh-TW; anything else -> en */
  function browserLang(list) {
    const tag = String((Array.isArray(list) ? list[0] : list) || "").toLowerCase();
    if (!/^zh(-|$)/.test(tag)) return "en";
    const parts = tag.split(/[-_]/).slice(1);
    if (parts.includes("hant")) return "zh-TW";
    if (parts.includes("hans")) return "zh-CN";
    if (parts.some((p) => ["tw", "hk", "mo"].includes(p))) return "zh-TW";
    if (parts.some((p) => ["cn", "sg"].includes(p))) return "zh-CN";
    return parts.length ? "en" : "zh-CN"; // a bare "zh" reads as Simplified
  }
  /** the stored choice when it is one of the three, else the browser's language */
  const initial = (stored, list) => (LANGS.includes(stored) ? stored : browserLang(list));
  /** T(): English, the zh-TW text, or the zh-CN text (explicit, else OpenCC's) */
  const pick = (lang, en, tw, cn) => (lang === "zh-TW" ? tw : lang === "zh-CN" ? (cn ?? toCN(tw)) : en);
  /** a bilingual field { en, "zh-TW", "zh-CN"? } (or a plain string) in this language */
  function loc(lang, t) {
    if (t == null) return "";
    if (typeof t !== "object") return String(t);
    if (lang === "zh-TW") return t["zh-TW"] || t.en || "";
    if (lang === "zh-CN") return t["zh-CN"] || (t["zh-TW"] ? toCN(t["zh-TW"]) : "") || t.en || "";
    return t.en || "";
  }
  /** an object keyed by language whose values are structures (card details, sections) */
  function deep(lang, o) {
    if (!o || typeof o !== "object") return undefined;
    if (lang === "zh-CN") return o["zh-CN"] || (o["zh-TW"] ? deepCN(o["zh-TW"]) : undefined) || o.en;
    return o[norm(lang)] || o.en;
  }
  /** a zh-TW-only field (label_tw, labelZh, zhTitle…) with its English fallback */
  const zhField = (lang, en, tw) => (lang === "en" || !tw ? en : lang === "zh-CN" ? toCN(tw) : tw);
  /** text a model reads keeps today's language: zh-CN models still get the zh-TW wording */
  const modelLang = (lang) => (lang === "zh-CN" ? "zh-TW" : norm(lang));
  /** the per-card language toggle: English and the page's Chinese */
  const cardLangs = (lang) => [["en", "EN"], lang === "zh-CN" ? ["zh-CN", "简中"] : ["zh-TW", "繁中"]];

  // Display-time conversion of a model reply, a log line or a server message (markdown) for 简体中文.
  // OpenCC converts the prose; these stay exactly as written:
  //   - a fenced block: a line starting (after up to 3 spaces) with ``` or ~~~ opens it, a line of the same
  //     character at least as long closes it; a fence that opens and never closes runs to the end of the text;
  //     ``` in the middle of a line opens nothing;
  //   - an indented block: lines indented 4 spaces or a tab that start after a blank line (or the text's start),
  //     with the blank lines inside it (an indented line inside a paragraph is prose);
  //   - inline code: a run of backticks up to the next run of the same length on the same line (an unmatched
  //     backtick is plain text);
  //   - a markdown link's target: "](" then 1-300 characters that are not ")" or whitespace, then ")" — the
  //     same rule md() (public/m2.js) uses for an href; the link text converts;
  //   - a bare URL or path: a run of ASCII URL/path characters that holds "/" or "\". It ends where the ASCII
  //     ends ("src/app.ts的設定" converts 設定), unless it ends in "/" or "\" with an ASCII letter or digit before
  //     that slash: then the next segment belongs to the path up to whitespace or closing punctuation
  //     ("src/設定.ts", "https://x/blob/main/設定.md" stay). A lone "/" or "\" is prose, so 開發/測試 and 見 /設定頁面 convert.
  // Every step is one forward scan: linear in the text.
  const ASCII_PATH = /[A-Za-z0-9_.~:@%+=&?#!$*\-\/\\]/;
  const isPathChar = (c) => c < 128 && ASCII_PATH.test(String.fromCharCode(c));
  const CLOSERS = new Set([..."，。、；：！？）」』”’》〉】,;)]}>\"'`"].map((c) => c.charCodeAt(0)));
  const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 0x3000;
  /** the [start, end) spans of one prose block that stay as written */
  function keepSpans(t) {
    const n = t.length, spans = [];
    // inline code: every backtick run, then each run pairs with the next run of the same length on its line
    const runs = []; let line = 0;
    for (let i = 0; i < n;) { const c = t.charCodeAt(i); if (c === 10) { line++; i++; continue; } if (c !== 96) { i++; continue; }
      let j = i; while (j < n && t.charCodeAt(j) === 96) j++; runs.push([i, j - i, line]); i = j; }
    const next = new Array(runs.length).fill(-1), seen = new Map();
    for (let r = runs.length - 1; r >= 0; r--) { const k = runs[r][1] + ":" + runs[r][2]; next[r] = seen.get(k) ?? -1; seen.set(k, r); }
    const code = [];
    for (let r = 0; r < runs.length;) { const m = next[r]; if (m >= 0) { code.push([runs[r][0], runs[m][0] + runs[m][1]]); r = m + 1; } else r++; }
    // outside inline code: link targets and bare URLs / paths
    let ci = 0;
    for (let i = 0; i < n;) {
      if (ci < code.length && i >= code[ci][0]) { spans.push(code[ci]); i = code[ci][1]; ci++; continue; }
      const stop = ci < code.length ? code[ci][0] : n, c = t.charCodeAt(i);
      if (c === 93 && t.charCodeAt(i + 1) === 40) {
        let j = i + 2; const lim = Math.min(stop, i + 2 + 300);
        while (j < lim) { const d = t.charCodeAt(j); if (d === 41 || isSpace(d)) break; j++; }
        if (j > i + 2 && j < stop && t.charCodeAt(j) === 41) { spans.push([i + 1, j + 1]); i = j + 1; continue; }
        i++; continue;
      }
      if (isPathChar(c) && (i === 0 || !isPathChar(t.charCodeAt(i - 1)))) {
        // named: an ASCII letter or digit comes before the run's last slash ("docs/", "x.tw/", "C:\\a\\"); a lone "/" is not
        let j = i, slash = false, alnum = false, named = false;
        while (j < stop && isPathChar(t.charCodeAt(j))) { const d = t.charCodeAt(j); if (d === 47 || d === 92) { slash = true; named = alnum; } else if ((d >= 48 && d <= 57) || ((d | 32) >= 97 && (d | 32) <= 122)) alnum = true; j++; }
        if (slash) {
          const last = t.charCodeAt(j - 1);
          if ((last === 47 || last === 92) && named) while (j < stop) { const d = t.charCodeAt(j); if (isSpace(d) || CLOSERS.has(d)) break; j++; }
          spans.push([i, j]);
        }
        i = j; continue;
      }
      i++;
    }
    return spans;
  }
  function inlineCN(t, o) {
    let out = "", last = 0;
    for (const [a, b] of keepSpans(t)) { out += toCN(t.slice(last, a), o) + t.slice(a, b); last = b; }
    return out + toCN(t.slice(last), o);
  }
  const shown = new Map();
  /** text shown in 简体中文: converted for display only; code, link targets, URLs and paths stay as written.
   *  Cached per text, except with live: true (a streaming reply, whose prefixes must not fill the caches). */
  function displayCN(s, o) {
    if (typeof s !== "string" || !s) return s;
    const live = !!o?.live;
    const hit = shown.get(s); if (hit !== undefined) return hit;
    const lines = s.split("\n"), out = []; let prose = [], blank = true;
    const flush = () => { if (prose.length) out.push(inlineCN(prose.join("\n"), o)); prose = []; };
    for (let i = 0; i < lines.length;) {
      const line = lines[i], f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        flush(); out.push(line); i++;
        const end = new RegExp(`^ {0,3}${f[1][0] === "`" ? "`" : "~"}{${f[1].length},}\\s*$`);
        while (i < lines.length) { const l = lines[i++]; out.push(l); if (end.test(l)) break; }
        blank = false; continue;
      }
      if (blank && /^( {4}|\t)/.test(line) && line.trim()) {
        flush();
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) out.push(lines[i++]);
        blank = !lines[i - 1].trim(); continue;
      }
      prose.push(line); blank = !line.trim(); i++;
    }
    flush();
    const r = out.join("\n");
    if (!live) { if (shown.size > 500) shown.clear(); shown.set(s, r); }
    return r;
  }
  /** a reply, log line or server message in the UI language: only 简体中文 changes it */
  const chatText = (lang, s, o) => (lang === "zh-CN" ? displayCN(s, o) : s);
  const NAMES = { en: "English", "zh-TW": "繁體中文", "zh-CN": "简体中文" };
  const locale = (lang) => (lang === "en" ? "en-US" : lang);
  const cacheSizes = () => ({ text: memo.size, shown: shown.size });
  window.crewI18n = { LANGS, NAMES, toCN, deepCN, displayCN, chatText, browserLang, initial, pick, loc, deep, zhField, modelLang, cardLangs, locale, cacheSizes };
})();
