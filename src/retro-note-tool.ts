// Firstmate's studio_note_issue: the captain says "this goes in the retro" or "note this: …" and Firstmate writes it down.
// Only a captain's own chat turn can call it (a card, a wake notice, an agent's question or an external CLI grant cannot), and
// what is kept is the captain's words, verbatim: the whole message, or a quote copied exactly from it. Never the model's
// rewording: text in a tool's arguments that the captain did not write is refused. It writes Studio only: the note at
// captain trust (data/retro/state.json) and a captain_note event naming it (actor firstmate, the turn: the audit).
import { captainWords } from "./firstmate";
import { NativeToolFailure, type NativeMainTools } from "./host/types";
import type { StudioLog } from "./rawlog";
import { oneLine, RetroStore, signal } from "./retro-signals";

export const NOTE_ISSUE_SPEC = { type: "function" as const, name: "studio_note_issue",
  description: "Write down a problem for the next retro when the captain asks (\"this goes in the retro\", \"note this: …\", 「記一下」, 「這要進 retro」). Studio keeps the captain's own words, verbatim: the whole message, or quote (copied exactly from the captain's message, never reworded). ref names what it is about when the captain said so (a Task id R-…, a pull request owner/repo#N, a review room id). Only on the captain's own message; it writes nothing outside Studio.",
  inputSchema: { type: "object", properties: { quote: { type: "string", description: "The part of the captain's message to keep, copied exactly; omit to keep the whole message." }, ref: { type: "string", description: "A Task id, owner/repo#N or a review room id the captain named." } }, additionalProperties: false } };

export function installNoteTool(dataDir: string, log: StudioLog | null | undefined): NativeMainTools {
  return { specs: [NOTE_ISSUE_SPEC], async call(name, args, owner) {
    if (name !== "studio_note_issue") throw new NativeToolFailure("invalid_params", "Unknown native tool", "未知的工具。", "read_current_state");
    if (!owner.live()) throw new NativeToolFailure("owner_ended", "The primary request ended.", "主要對話請求已結束。");
    // the captain's own chat message only: never a card, a wake, an agent's question, a gate repair or a CLI grant
    const words = oneLine(captainWords(owner.text));
    if (!owner.captain || owner.origin?.grant || owner.repair || !words) throw new NativeToolFailure("owner_ended", "Only the captain's own message can note a problem for the retro.", "只有船長自己的訊息可以記下問題。");
    const a: any = args && typeof args === "object" && !Array.isArray(args) ? args : null;
    if (!a || Object.keys(a).some((k) => k !== "quote" && k !== "ref") || (a.quote !== undefined && typeof a.quote !== "string") || (a.ref !== undefined && typeof a.ref !== "string"))
      throw new NativeToolFailure("invalid_params", "studio_note_issue takes quote and ref (both optional strings).", "studio_note_issue 只接受 quote 和 ref（皆為選填字串）。", "read_current_state");
    let text = words;
    if (a.quote !== undefined) { const q = oneLine(a.quote); if (!q || !words.includes(q)) throw new NativeToolFailure("invalid_params", "quote must be copied exactly from the captain's message; omit it to keep the whole message.", "quote 必須一字不差取自船長的訊息；省略則保留整段訊息。", "read_current_state"); text = q; }
    const ref = a.ref !== undefined && /^[\w.\/#:@-]{1,160}$/.test(a.ref.trim()) ? a.ref.trim() : null;
    const n = new RetroStore(dataDir).addNote({ text, by: "firstmate", kind: "note", route: null, ref });
    signal(log, "captain_note", { route: null, ref, note: n.id, by: "firstmate", turn: owner.key.slice(0, 120) }, { actor: "firstmate" });
    return { noted: n.id, kept: text, href: "#/improve/candidates", note: "Kept in the captain's words for the next retro (Improve → Candidates)." };
  } };
}
