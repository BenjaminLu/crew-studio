// Mixed Chinese and English narration for the local voice. Kokoro's Mandarin voices mangle the English words of a code
// review (PR, GitHub, diff), so by default a point is cut into runs and each run is spoken by the voice of its language:
// a Latin run (words, with the digits and joiners inside them: gpt-4o, v1.0, CI/CD) by the English voice, the rest by the
// Chinese one. "same" keeps the room language's voice for the whole point.

export type Mix = "switch" | "same";
export const MIXES: readonly Mix[] = ["switch", "same"];
export type Run = { text: string; lang: "zh" | "en" };

/** the speakers of the pinned model (sherpa-onnx's kokoro-multi-lang-v1_0 speaker ids) the room offers */
export const SPEAKERS: Record<string, number> = { af_heart: 3, af_bella: 2, af_nicole: 6, am_michael: 16, bf_emma: 21,
  zf_xiaobei: 45, zf_xiaoni: 46, zf_xiaoxiao: 47, zf_xiaoyi: 48, zm_yunjian: 49, zm_yunxi: 50, zm_yunxia: 51, zm_yunyang: 52 };
export const DEFAULT_VOICE = { zh: "zf_xiaobei", en: "af_heart" } as const;

const HAN = /[㐀-鿿豈-﫿]/;
// a Latin run: a word starting with a letter, then more words joined by spaces or the joiners code names use
const LATIN = /[A-Za-z][A-Za-z0-9]*(?:(?:[ .'’_\/+#&:-]|\s)+[A-Za-z0-9][A-Za-z0-9]*)*(?:[+#])?/g;
const SPOKEN = /[\p{L}\p{N}]/u;

/** the room's language as one of the model's: zh for zh-TW and zh-CN, else en */
export const langOf = (l: unknown): "zh" | "en" => (/^zh/i.test(String(l ?? "")) ? "zh" : "en");

/** Cut text into runs by language; text with nothing to say gives none. "same": one run in the room's language. */
export function splitRuns(text: string, mode: Mix, room: "zh" | "en"): Run[] {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || !SPOKEN.test(t)) return [];
  if (mode === "same") return [{ text: t, lang: room }];
  // a point with no Chinese at all is English, whatever the room's language (and a Chinese room's English point gets the English voice)
  if (!HAN.test(t)) return [{ text: t, lang: "en" }];
  const out: Run[] = [];
  const push = (s: string, lang: "zh" | "en") => {
    if (!s) return;
    const last = out.at(-1);
    // what has nothing to say (punctuation, spaces) or the same language joins its neighbour
    if (last && (last.lang === lang || !SPOKEN.test(s))) { last.text += s; return; }
    if (!SPOKEN.test(s)) { out.push({ text: s, lang: "zh" }); return; }
    if (last && !SPOKEN.test(last.text)) { last.text += s; last.lang = lang; return; }
    out.push({ text: s, lang });
  };
  let at = 0;
  for (const m of t.matchAll(LATIN)) { push(t.slice(at, m.index), "zh"); push(m[0], "en"); at = m.index! + m[0].length; }
  push(t.slice(at), "zh");
  return out.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text && SPOKEN.test(r.text));
}
