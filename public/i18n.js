// The UI languages: English, 繁體中文 (zh-TW) and 简体中文 (zh-CN). zh-CN is never a
// third hand-written copy: it is derived from the zh-TW text by toCN() — the reviewed
// terms and overrides in zh-cn-terms.js, then OpenCC's character table in
// zh-cn-chars.js. Every language branch in the UI goes through pick / loc / deep,
// so a zh-CN field from the server, or T()'s third argument, wins where present.
// Model inputs keep the language they had before zh-CN existed: modelLang().
(() => {
  const Z = window.crewZhChars || { chars: "", phrases: "" }, W = window.crewZhTerms || { terms: {}, overrides: {} };
  const LANGS = ["en", "zh-TW", "zh-CN"];
  const chars = new Map(), words = new Map(), byFirst = new Map(); // byFirst: first character -> word lengths, longest first
  for (const e of Z.chars.split("|")) { const [k, v] = e.split(" "); if (k && v) chars.set(k, v); }
  // OpenCC's phrases (an identity phrase like 著名 -> 著名 shields its characters), then Studio's terms (a term replaces a phrase with the same key)
  const word = (k, v) => { const cs = [...k]; if (cs.length < 2) { chars.set(k, v); return; } words.set(k, v);
    const l = byFirst.get(cs[0]) || []; if (!l.includes(cs.length)) { l.push(cs.length); l.sort((a, b) => b - a); } byFirst.set(cs[0], l); };
  for (const e of Z.phrases.split("|")) { const [k, v] = e.split(" "); if (k && v) word(k, v); }
  for (const [k, v] of Object.entries(W.terms || {})) word(k, v);
  const overrides = new Map(Object.entries(W.overrides || {}));
  const memo = new Map();
  /** zh-TW text -> zh-CN text: an exact override, else one longest-match pass of terms and phrases, then characters. Linear in the text. */
  function toCN(s) {
    if (typeof s !== "string" || !s) return s;
    if (overrides.has(s)) return overrides.get(s);
    const hit = memo.get(s); if (hit !== undefined) return hit;
    const cs = Array.from(s); let out = "";
    for (let i = 0; i < cs.length;) {
      const lens = byFirst.get(cs[i]); let done = false;
      if (lens) for (const n of lens) {
        if (i + n > cs.length) continue;
        const v = words.get(cs.slice(i, i + n).join(""));
        if (v !== undefined) { out += v; i += n; done = true; break; }
      }
      if (done) continue;
      const c = cs[i++]; out += chars.get(c) ?? c;
    }
    if (memo.size > 20000) memo.clear();
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
  /** T(): English, the zh-TW text, or the zh-CN text (explicit, else derived) */
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
  // Display-time conversion of a model reply (markdown) for 简体中文. Left exactly as written:
  //   - a fenced block: a line starting (after up to 3 spaces) with ``` or ~~~ opens it, a line of the same
  //     character at least as long closes it; a fence that opens and never closes runs to the end of the text;
  //     ``` in the middle of a line opens nothing;
  //   - an indented block: lines indented 4 spaces or a tab that start after a blank line (or the text's start),
  //     with the blank lines inside it (an indented line inside a paragraph is prose);
  //   - inline code: a run of backticks up to the next run of the same length on the same line (an unmatched
  //     backtick is plain text);
  //   - a markdown link's target: "(…)" right after "]", up to ")" with no space; the link text converts.
  // URLs and file paths are ASCII by definition here: they end at the first Han character, and conversion never
  // changes ASCII, so "src/app.ts的設定" keeps the path and converts 設定. One pass, linear in the text.
  function inlineCN(t) {
    let out = "", last = 0, i = 0, lineEnd = -1; const n = t.length, noClose = new Map();
    while (i < n) {
      const c = t.charCodeAt(i);
      if (c === 10) { noClose.clear(); i++; continue; }
      if (c === 96) {
        let j = i; while (j < n && t.charCodeAt(j) === 96) j++;
        const run = j - i; if (lineEnd < j) { lineEnd = t.indexOf("\n", j); if (lineEnd < 0) lineEnd = n; }
        let close = -1;
        if (!(noClose.get(run) >= j)) {
          for (let k = j; k < lineEnd;) { const b = t.indexOf("`", k); if (b < 0 || b >= lineEnd) break; let e = b; while (e < n && t.charCodeAt(e) === 96) e++; if (e - b === run) { close = b; break; } k = e; }
          if (close < 0) noClose.set(run, lineEnd);
        }
        if (close >= 0) { out += toCN(t.slice(last, i)) + t.slice(i, close + run); i = last = close + run; continue; }
        i = j; continue;
      }
      if (c === 93 && t.charCodeAt(i + 1) === 40) {
        let j = i + 2; while (j < n) { const d = t.charCodeAt(j); if (d === 41 || d === 40 || d === 32 || d === 9 || d === 10 || d === 13) break; j++; }
        if (j < n && t.charCodeAt(j) === 41) { out += toCN(t.slice(last, i + 1)) + t.slice(i + 1, j + 1); i = last = j + 1; continue; }
        i = j; continue;
      }
      i++;
    }
    return out + toCN(t.slice(last));
  }
  const shown = new Map();
  /** a model reply or chat line shown in 简体中文: converted for display only (cached per text); code and link targets stay as written */
  function displayCN(s) {
    if (typeof s !== "string" || !s) return s;
    const hit = shown.get(s); if (hit !== undefined) return hit;
    const lines = s.split("\n"), out = []; let prose = [], blank = true;
    const flush = () => { if (prose.length) out.push(inlineCN(prose.join("\n"))); prose = []; };
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
    if (shown.size > 500) shown.clear();
    shown.set(s, r); return r;
  }
  const chatText = (lang, s) => (lang === "zh-CN" ? displayCN(s) : s);
  const NAMES = { en: "English", "zh-TW": "繁體中文", "zh-CN": "简体中文" };
  const locale = (lang) => (lang === "en" ? "en-US" : lang);
  window.crewI18n = { LANGS, NAMES, toCN, deepCN, displayCN, chatText, browserLang, initial, pick, loc, deep, zhField, modelLang, cardLangs, locale };
})();
