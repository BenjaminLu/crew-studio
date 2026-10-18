// Proposals an empty team seat held (live E2E S8), kept on disk so a Studio restart still proposes the work again:
//   data/firstmate/held-proposals.json   { schema: 1, held: { <seat card's Task id>: [{ args, owner: { key, text } }] }, resuming: [<Task id>] }
// The key is the seat card's Task (the crew-change run: one card each); the card is raised after the refusal, so its own
// id does not exist yet when a proposal is held. Written atomically (temp file, then rename; 0600).
// Approving the card first marks its entry "resuming", then proposes, then drops it: a crash in between leaves the mark,
// and boot resumes it (resuming is idempotent: the same captain turn and text find the proposal already made). An
// unmarked entry goes when its seat card's Task has ended without approval (closed, failed, cancelled) or is gone. A
// missing file is no held proposals; a corrupt one is too, and says so in the log: never a reason to stop proposing.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Held = { args: any; owner: { key: string; text: string } };
type State = { held: Record<string, Held[]>; resuming: string[] };

export class HeldProposals {
  readonly file: string;
  /** alive: the seat card's Task is still open; approved: it ended with the captain's approval (boot resumes those) */
  constructor(dataDir: string, private alive: (seatRun: string) => boolean, private warn: (m: string) => void = (m) => console.warn(m), private approved: (seatRun: string) => boolean = () => false) { this.file = join(dataDir, "firstmate", "held-proposals.json"); }
  private read(): State {
    let raw: string;
    try { raw = readFileSync(this.file, "utf8"); } catch (e: any) { if (e?.code !== "ENOENT") this.warn(`crew-studio: held proposals unreadable (${e?.code ?? e}); none are kept`); return { held: {}, resuming: [] }; }
    try {
      const f = JSON.parse(raw);
      if (f?.schema !== 1 || !f.held || typeof f.held !== "object" || Array.isArray(f.held)) throw new Error("not a held-proposals file");
      const held: Record<string, Held[]> = {};
      for (const [run, list] of Object.entries(f.held)) if (/^R-\d+$/.test(run) && Array.isArray(list)) held[run] = list.filter((h: any) => h && typeof h === "object" && h.args && typeof h.owner?.key === "string" && typeof h.owner?.text === "string");
      return { held, resuming: Array.isArray(f.resuming) ? f.resuming.filter((r: unknown) => typeof r === "string" && r in held) : [] };
    } catch (e: any) { this.warn(`crew-studio: held proposals file is corrupt (${e?.message ?? e}); none are kept`); return { held: {}, resuming: [] }; }
  }
  private write(st: State) {
    // an entry stays while its card is open, while it is resuming, or while its card ended approved (boot resumes it)
    const keep = (run: string) => st.resuming.includes(run) || this.alive(run) || this.approved(run);
    const held = Object.fromEntries(Object.entries(st.held).filter(([run, list]) => list.length && keep(run)));
    try {
      mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ schema: 1, held, resuming: st.resuming.filter((r) => r in held) }, null, 1), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (e: any) { this.warn(`crew-studio: held proposals not saved (${e?.message ?? e})`); }
  }
  /** Hold one proposal on a seat card (the same captain turn and text once). */
  hold(seatRun: string, h: Held) {
    const st = this.read();
    st.held[seatRun] = [...(st.held[seatRun] ?? []).filter((x) => x.owner.key !== h.owner.key || x.args?.text !== h.args?.text), h];
    this.write(st);
  }
  /** The seat card was approved: mark its proposals resuming (a crash from here on resumes them at boot) and return them. */
  mark(seatRun: string): Held[] {
    const st = this.read(), list = st.held[seatRun] ?? [];
    if (list.length && !st.resuming.includes(seatRun)) { st.resuming.push(seatRun); this.write(st); }
    return list;
  }
  /** Its proposals were proposed again: the entry goes. */
  done(seatRun: string) { const st = this.read(); if (!(seatRun in st.held)) return; delete st.held[seatRun]; st.resuming = st.resuming.filter((r) => r !== seatRun); this.write(st); }
  /** At boot: the seat cards whose proposals still wait to be proposed again (marked resuming, or approved before the mark was written). */
  pending(): string[] { const st = this.read(); return Object.keys(st.held).filter((run) => st.resuming.includes(run) || (!this.alive(run) && this.approved(run))); }
}
