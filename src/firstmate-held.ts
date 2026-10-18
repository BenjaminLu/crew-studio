// Proposals an empty team seat held (live E2E S8), kept on disk so a Studio restart between the seat card being raised
// and the captain approving it still proposes the work again:
//   data/firstmate/held-proposals.json   { schema: 1, held: { <seat card's Task id>: [{ args, owner: { key, text } }] } }
// The key is the seat card's Task (the crew-change run: one card each); the card is raised after the refusal, so its own
// id does not exist yet when a proposal is held. Written atomically (temp file, then rename; 0600). An entry goes when
// it is resumed, or when its seat card's Task has ended without approval (closed, failed, cancelled) or is gone. A
// missing file is no held proposals; a corrupt one is too, and says so in the log: never a reason to stop proposing.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Held = { args: any; owner: { key: string; text: string } };
type File = { schema: 1; held: Record<string, Held[]> };

export class HeldProposals {
  readonly file: string;
  constructor(dataDir: string, private alive: (seatRun: string) => boolean, private warn: (m: string) => void = (m) => console.warn(m)) { this.file = join(dataDir, "firstmate", "held-proposals.json"); }
  private read(): Record<string, Held[]> {
    let raw: string;
    try { raw = readFileSync(this.file, "utf8"); } catch (e: any) { if (e?.code !== "ENOENT") this.warn(`crew-studio: held proposals unreadable (${e?.code ?? e}); none are kept`); return {}; }
    try {
      const f = JSON.parse(raw) as File;
      if (f?.schema !== 1 || !f.held || typeof f.held !== "object" || Array.isArray(f.held)) throw new Error("not a held-proposals file");
      const out: Record<string, Held[]> = {};
      for (const [run, list] of Object.entries(f.held)) if (/^R-\d+$/.test(run) && Array.isArray(list)) out[run] = list.filter((h) => h && typeof h === "object" && h.args && typeof h.owner?.key === "string" && typeof h.owner?.text === "string");
      return out;
    } catch (e: any) { this.warn(`crew-studio: held proposals file is corrupt (${e?.message ?? e}); none are kept`); return {}; }
  }
  private write(held: Record<string, Held[]>) {
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ schema: 1, held } satisfies File, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  /** The held proposals whose seat card is still open. */
  private live(): Record<string, Held[]> { return Object.fromEntries(Object.entries(this.read()).filter(([run, list]) => list.length && this.alive(run))); }
  /** Hold one proposal on a seat card (the same captain turn and text once). */
  hold(seatRun: string, h: Held) {
    const all = this.live();
    all[seatRun] = [...(all[seatRun] ?? []).filter((x) => x.owner.key !== h.owner.key || x.args?.text !== h.args?.text), h];
    try { this.write(all); } catch (e: any) { this.warn(`crew-studio: held proposals not saved (${e?.message ?? e})`); }
  }
  /** Take every proposal a seat card held (it was approved): they leave the file. */
  take(seatRun: string): Held[] {
    const all = this.read(), list = all[seatRun] ?? [];
    if (!(seatRun in all)) return [];
    delete all[seatRun];
    try { this.write(Object.fromEntries(Object.entries(all).filter(([run]) => this.alive(run)))); } catch (e: any) { this.warn(`crew-studio: held proposals not saved (${e?.message ?? e})`); }
    return list;
  }
}
