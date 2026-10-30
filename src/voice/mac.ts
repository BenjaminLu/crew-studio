// This Mac's own voices for the room's languages, with their quality (AVSpeechSynthesisVoice: 1 compact/default,
// 2 Enhanced, 3 Premium), read through osascript's JavaScript bridge. Doctor shows them; the room's page picks the best
// one itself in the browser.
import { scrubEnv } from "../secure";

export type MacVoice = { lang: string; name: string; quality: 1 | 2 | 3; id: string };
// never worth offering: novelty voices and the robotic Eloquence / MacinTalk ones (public/review-room.js NOVELTY, LEGACY)
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|princess|ralph)$/i;
const JXA = `ObjC.import('AVFoundation'); const vs = $.AVSpeechSynthesisVoice.speechVoices, out = [];
for (let i = 0; i < vs.count; i++) { const v = vs.objectAtIndex(i); out.push([v.language.js, v.name.js, Number(v.quality), v.identifier.js]); }
JSON.stringify(out);`;

let memo: { at: number; v: MacVoice[] | null } | null = null;
/** zh-TW and English voices on this Mac, best first; null when they cannot be read (not macOS, osascript refused) */
export function macVoices(fresh = false): MacVoice[] | null {
  if (!fresh && memo && Date.now() - memo.at < 5 * 60_000) return memo.v;
  let v: MacVoice[] | null = null;
  if (process.platform === "darwin") try {
    const r = Bun.spawnSync(["/usr/bin/osascript", "-l", "JavaScript", "-"], { stdin: new TextEncoder().encode(JXA), env: scrubEnv(), stdout: "pipe", stderr: "pipe", timeout: 8000 });
    if (r.success) v = (JSON.parse(r.stdout.toString()) as any[]).map(([lang, name, quality, id]) => ({ lang: String(lang), name: String(name), quality: (Number(quality) >= 3 ? 3 : Number(quality) === 2 ? 2 : 1) as 1 | 2 | 3, id: String(id) }));
  } catch {}
  memo = { at: Date.now(), v: v ? pick(v) : null }; return memo.v;
}
export const pick = (all: MacVoice[]) => all.filter((x) => (/^zh-TW$/i.test(x.lang) || /^en-/i.test(x.lang)) && !NOVELTY.test(x.name) && !/eloquence|speech\.synthesis/.test(x.id))
  .sort((a, b) => b.quality - a.quality || Number(/^en-US$/.test(b.lang)) - Number(/^en-US$/.test(a.lang)));
