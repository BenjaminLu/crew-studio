// The script a captain writes Chinese in (E2E F2): Firstmate replied in Simplified Chinese to a captain writing
// Traditional, because its seed named the dashboard language. Each captain turn written in Traditional Chinese
// now carries a one-line Studio note saying so. Studio keeps no conversion table of its own: a text is Traditional
// when opencc-js (the same pinned converter as the 简体中文 UI) changes it on the way to Simplified.
import { Converter } from "opencc-js/t2cn";

const toCN = Converter({ from: "tw", to: "cn" });
const HAN = /\p{Script=Han}/u, KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

export const TRADITIONAL_NOTE = "[Studio note: any Chinese in this message is Traditional (繁體中文); when you reply in Chinese, use Traditional, not Simplified.]";

/** "traditional" when the text has a character opencc-js maps to a different Simplified one; "chinese" for Han text with none;
 * null for text without Han, and for Japanese (kana), whose kanji opencc-js would also change. */
export function captainScript(text: string): "traditional" | "chinese" | null {
  if (!HAN.test(text) || KANA.test(text)) return null;
  return toCN(text) !== text ? "traditional" : "chinese";
}

/** The turn as sent to Firstmate: the captain's words, then the note when they wrote Traditional Chinese. */
export function withScriptNote(sendText: string, captainText: string): string {
  return captainScript(captainText) === "traditional" ? `${sendText}\n\n${TRADITIONAL_NOTE}` : sendText;
}
