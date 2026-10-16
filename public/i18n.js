// The UI languages: English, 繁體中文 (zh-TW) and 简体中文 (zh-CN). zh-CN is never a
// third hand-written copy: it is derived from the zh-TW text by toCN() — the reviewed
// terms and overrides in zh-cn-terms.js, then OpenCC's character table in
// zh-cn-chars.js. Every language branch in the UI goes through pick / loc / deep,
// so a zh-CN field from the server, or T()'s third argument, wins where present.
// Model inputs keep the language they had before zh-CN existed: modelLang().
(() => {
  const Z = window.crewZhChars || { chars: "", phrases: "" }, W = window.crewZhTerms || { terms: {}, overrides: {} };
  const LANGS = ["en", "zh-TW", "zh-CN"];
  const chars = new Map(), words = new Map(); let longest = 1;
  for (const e of Z.chars.split("|")) { const [k, v] = e.split(" "); if (k && v) chars.set(k, v); }
  // OpenCC's exception phrases, then Studio's terms (a term replaces a phrase with the same key)
  const word = (k, v) => { const n = [...k].length; if (n < 2) { chars.set(k, v); return; } words.set(k, v); longest = Math.max(longest, n); };
  for (const e of Z.phrases.split("|")) { const [k, v] = e.split(" "); if (k && v) word(k, v); }
  for (const [k, v] of Object.entries(W.terms || {})) word(k, v);
  const overrides = new Map(Object.entries(W.overrides || {}));
  const memo = new Map();
  /** zh-TW text -> zh-CN text: an exact override, else one longest-match pass of terms, then characters. */
  function toCN(s) {
    if (typeof s !== "string" || !s) return s;
    if (overrides.has(s)) return overrides.get(s);
    const hit = memo.get(s); if (hit !== undefined) return hit;
    const cs = [...s]; let out = "";
    for (let i = 0; i < cs.length;) {
      let done = false;
      if (words.size) for (let n = Math.min(longest, cs.length - i); n >= 2; n--) {
        const k = cs.slice(i, i + n).join(""), v = words.get(k);
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
  /** the first preferred browser language: zh-CN / zh-SG / zh-Hans -> zh-CN; zh-TW / zh-HK / zh-Hant -> zh-TW; anything else -> en */
  function browserLang(list) {
    const tag = String((Array.isArray(list) ? list[0] : list) || "").toLowerCase();
    if (!/^zh(-|$)/.test(tag)) return "en";
    const parts = tag.split(/[-_]/).slice(1);
    if (parts.includes("hant")) return "zh-TW";
    if (parts.includes("hans")) return "zh-CN";
    if (parts.some((p) => ["tw", "hk", "mo"].includes(p))) return "zh-TW";
    if (parts.some((p) => ["cn", "sg"].includes(p))) return "zh-CN";
    return "en";
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
  const NAMES = { en: "English", "zh-TW": "繁體中文", "zh-CN": "简体中文" };
  const locale = (lang) => (lang === "en" ? "en-US" : lang);
  window.crewI18n = { LANGS, NAMES, toCN, deepCN, browserLang, initial, pick, loc, deep, zhField, modelLang, cardLangs, locale };
})();
