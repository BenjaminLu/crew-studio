// One FIFO for everything that goes into the attached main session: the
// captain's chat, card answers (as notices) and firstmate wakes. One item per
// turn, never a BUSY refusal. Wakes that arrive while a turn is running fold
// into one waiting wake item (identical lines once), as the stop-hook did.
export type QKind = "chat" | "card" | "wake";
export type WakeRef = { id: string; woken: number; key: string; line: string; queuedAt?: number };
export type QItem = { id: string; kind: QKind; text: string; lines?: string[]; wakes?: WakeRef[]; source: string; at: number };

export const WAKE_TAIL = "Handle each event, then advance already authorized actionable follow-ups: verification, review/gates, " +
  "concrete board merge within current authorization, self-update and authorized next dispatch. End or park only when no runnable " +
  "authorized step remains; name the real dependency, event or exact operator action required.";
export const wakeText = (lines: string[]) => `firstmate wake:\n${lines.join("\n")}\n${WAKE_TAIL}`;

/** When the last wake folded into this item arrived (its own arrival for anything else). */
export const lastArrival = (i: QItem) => Math.max(i.at, ...(i.wakes ?? []).map((w) => w.queuedAt ?? i.at));

export class InputQueue {
  private items: QItem[] = [];
  private n = 0;
  onChange: (items: QItem[]) => void = () => {};

  list(): QItem[] { return this.items.slice(); }
  get length() { return this.items.length; }

  push(kind: QKind, text: string, source: string, ref?: WakeRef): QItem {
    const at = Date.now();
    if (ref) ref = { ...ref, queuedAt: at }; // each wake keeps its own arrival: a grace is measured per wake, never on the folded item
    if (kind === "wake") {
      const waiting = this.items.find((i) => i.kind === "wake");
      if (waiting) {
        if (!waiting.lines!.includes(text)) waiting.lines!.push(text);
        if (ref && !waiting.wakes!.some((w) => w.key === ref.key)) waiting.wakes!.push(ref);
        waiting.text = wakeText(waiting.lines!);
        this.onChange(this.list());
        return waiting;
      }
      const item: QItem = { id: `q${++this.n}`, kind, lines: [text], wakes: ref ? [ref] : [], text: wakeText([text]), source, at };
      this.items.push(item); this.onChange(this.list()); return item;
    }
    const item: QItem = { id: `q${++this.n}`, kind, text, source, at };
    this.items.push(item); this.onChange(this.list()); return item;
  }

  /** A new thread must receive its context before any retained captain input. */
  seed(text: string): QItem {
    const item: QItem = { id: `q${++this.n}`, kind: "chat", text, source: "studio:handoff", at: Date.now() };
    this.items.unshift(item); this.onChange(this.list()); return item;
  }

  /** Take the first item `ready` allows (a held wake does not block the captain's messages behind it). */
  take(ready: (i: QItem) => boolean): QItem | undefined {
    const k = this.items.findIndex(ready);
    if (k < 0) return undefined;
    const [i] = this.items.splice(k, 1); this.onChange(this.list()); return i;
  }
  /** Drop the lines of a waiting wake that firstmate already delivered; the item goes when none is left. */
  prune(delivered: (w: WakeRef) => boolean): WakeRef[] {
    const gone: WakeRef[] = [];
    for (const i of this.items.filter((x) => x.kind === "wake" && x.wakes?.length)) {
      const left = i.wakes!.filter((w) => { const d = delivered(w); if (d) gone.push(w); return !d; });
      if (left.length === i.wakes!.length) continue;
      i.wakes = left;
      const keep = new Set(left.map((w) => w.line));
      i.lines = i.lines!.filter((l) => keep.has(l));
      if (!i.lines.length) this.items.splice(this.items.indexOf(i), 1); else i.text = wakeText(i.lines);
    }
    if (gone.length) this.onChange(this.list());
    return gone;
  }

  shift(): QItem | undefined { const i = this.items.shift(); if (i) this.onChange(this.list()); return i; }
  remove(id: string): boolean { const k = this.items.findIndex((i) => i.id === id); if (k < 0) return false; this.items.splice(k, 1); this.onChange(this.list()); return true; }
  clear() { this.items = []; this.onChange([]); }
}
