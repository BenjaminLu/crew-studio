// This Mac's own voices for the room's languages, with their quality (AVSpeechSynthesisVoice: 1 compact/default,
// 2 Enhanced, 3 Premium), read through osascript's JavaScript bridge. Doctor shows them; the room's page picks the best
// one itself in the browser. osascript runs as an asynchronous child process (it can take seconds; Studio keeps
// answering meanwhile), one at a time: callers while it runs share its answer.
import { scrubEnv } from "../secure";

export type MacVoice = { lang: string; name: string; quality: 1 | 2 | 3; id: string };
// never worth offering: novelty voices and the robotic Eloquence / MacinTalk ones (public/review-room.js NOVELTY, LEGACY)
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|princess|ralph)$/i;
const JXA = `ObjC.import('AVFoundation'); const vs = $.AVSpeechSynthesisVoice.speechVoices, out = [];
for (let i = 0; i < vs.count; i++) { const v = vs.objectAtIndex(i); out.push([v.language.js, v.name.js, Number(v.quality), v.identifier.js]); }
JSON.stringify(out);`;

/** run osascript's JavaScript on stdin; its stdout, or null (tests pass their own) */
export type Runner = (script: string) => Promise<string | null>;
const osascript: Runner = async (script) => {
  if (process.platform !== "darwin") return null;
  try { const p = Bun.spawn(["/usr/bin/osascript", "-l", "JavaScript", "-"], { stdin: new TextEncoder().encode(script), env: scrubEnv(), stdout: "pipe", stderr: "ignore" });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, 8000);
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]); clearTimeout(t); return code === 0 ? out : null; } catch { return null; }
};
let memo: { at: number; v: MacVoice[] | null } | null = null, pending: Promise<MacVoice[] | null> | null = null;
/** zh-TW and English voices on this Mac, best first; null when they cannot be read (not macOS, osascript refused) */
export function macVoices(fresh = false, run: Runner = osascript): Promise<MacVoice[] | null> {
  if (!fresh && memo && Date.now() - memo.at < 5 * 60_000) return Promise.resolve(memo.v);
  if (pending) return pending;
  pending = (async () => {
    let v: MacVoice[] | null = null;
    try { const out = await run(JXA); if (out) v = pick((JSON.parse(out) as any[]).map(([lang, name, quality, id]) => ({ lang: String(lang), name: String(name), quality: (Number(quality) >= 3 ? 3 : Number(quality) === 2 ? 2 : 1) as 1 | 2 | 3, id: String(id) }))); } catch {}
    memo = { at: Date.now(), v }; return v;
  })().finally(() => { pending = null; });
  return pending;
}
export const pick = (all: MacVoice[]) => all.filter((x) => (/^zh-TW$/i.test(x.lang) || /^en-/i.test(x.lang)) && !NOVELTY.test(x.name) && !/eloquence|speech\.synthesis/.test(x.id))
  .sort((a, b) => b.quality - a.quality || Number(/^en-US$/.test(b.lang)) - Number(/^en-US$/.test(a.lang)));
