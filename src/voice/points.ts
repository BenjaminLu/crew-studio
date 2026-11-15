// What the local voice may speak in a room: only the room's own words. The page sends a point as it shows it (a
// sentence of an older answer, a translation, the Simplified form of a zh-TW room), so a text is accepted when it is part
// of one of the room's texts: a scene's point, an answer's claim (and Studio's zh-TW line for it), an answer, a kept
// translation, a check's question. Both sides are compared without citations, markup or spaces, in Simplified Chinese
// (opencc-js, as the page converts), so script and spacing never decide.
import { Converter } from "opencc-js/t2cn";

const toCN = Converter({ from: "twp", to: "cn" });
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : []);
/** every text of the room the voice may speak */
export function roomTexts(room: any): string[] {
  const out: string[] = [];
  for (const t of room?.turns ?? []) {
    out.push(...strings(t.answer));
    for (const s of t.scenes ?? []) for (const p of s.points ?? []) out.push(...strings(p?.text));
    for (const c of t.claims ?? []) out.push(...strings(c?.text), ...strings(c?.zh));
  }
  for (const byTurn of Object.values(room?.translations ?? {}) as any[]) for (const tr of Object.values(byTurn ?? {}) as any[]) {
    out.push(...strings(tr?.answer), ...strings(tr?.claims));
    for (const s of tr?.scenes ?? []) out.push(...strings(s?.points));
  }
  for (const q of room?.check?.questions ?? []) out.push(...strings(q?.q));
  return out;
}
/** is text part of one of the room's texts? clean is the room's own narration cleaner (citations and markup out) */
export function isRoomPoint(room: any, text: string, clean: (t: string) => string): boolean {
  const norm = (t: string) => toCN(clean(t)).replace(/\s+/g, "");
  const want = norm(text); if (!want) return false;
  return roomTexts(room).some((t) => norm(t).includes(want));
}
