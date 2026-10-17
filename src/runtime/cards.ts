// Studio-owned cards (docs/architecture.md §3.4): the captain's inbox for Studio
// runs. A card belongs to one node of one run, carries its intent sections in en
// and zh-TW, is STE-checked, and is answered exactly once; the answer moves the
// run on. Firstmate's own cards never come here: they stay on the v1 board.
//   data/cards/<id>.json
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allocate } from "../ids";
import type { Failure } from "./failures";

export const CARD_KINDS = ["dispatch", "plan", "scope", "step-back", "round-budget", "merge", "promote", "acceptance", "retro", "permission", "question", "failure"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
/** The intent sections every card carries, per locale. */
export type Sections = { intent: string; why: string; scope: { in: string[]; out: string[] }; done: string[]; beforeAfter: string; how: string; glossary: { term: string; means: string }[] };
export type InterviewBatch = {schema:1;visit:number;batchHash:string;questions:{key:string;en:string;zh:string}[];revision:number;answers:Record<string,string>};
export type LocalRescope = {version:1;card:string;visit:number;base:string;from:string;target:string;baseRelation?:"patch-equivalent-unadmitted";strategy?:"preserve-commits";originalBase?:string};
export type CardOption = { id: string; label: string; labelZh?: string; primary?: boolean; note?: boolean; noteLabel?: string; noteLabelZh?: string; select?: { value: string; label: string }[]; hold?: boolean };
export type SCard = {
  /** Read-only code recovery preview; execution requires the same descriptor in the answer. */
  localRescope?: LocalRescope;
  /** the typed failure this card is about (src/runtime/failures.ts): its class decides the options */
  failure?: Failure | null;
  id: string; run: string; node: string; visit: number; kind: CardKind; title: { en: string; "zh-TW": string }; sections: { en: Sections; "zh-TW": Sections }; body: string;
  interview?: InterviewBatch;
  /** hold: an option that does not go through the door (close, request changes); every other option needs the door confirmation when the card's door is one-way */
  /** note: the option opens its own note box (noteLabel says what to write there); select: a picker whose value becomes the note */
  options: CardOption[];
  confirmDoor: boolean; door: string | null; links: { label: string; href: string }[]; ledger?: any; ste?: { verdict: string; findings: number; seq: number | null } | null;
  /** optional structured detail (intent sections, proofs, walk, alignment lines); see CardDetail */
  detail?: CardDetail | null;
  /** an authorization window never answers this card (set by its body; the merge card sets it) */
  captainOnly?: boolean;
  /** Firstmate decided this escalation within the spec (engine decideEscalation); the captain did not */
  decidedBy?: "firstmate";
  status: "open" | "answered" | "cancelled"; createdAt: string;
  answer: { choice: string; note: string | null; by: string; at: string; confirm: string | null; aligned?: number[] | null; localRescope?: LocalRescope; crew?: Record<string, string | null> } | null;
  workflow: string; runTitle: string;
  /** before / after captures of an app the change touches (a domain check fills them): image URLs and the visible text that changed */
  captures?: { label: string; before: string | null; after: string | null; changed?: { removed: string[]; added: string[] } | null }[] | null;
  /** a startup competition acceptance card: every signed round and the pinned artifact (added on read from the signed ledger), or `{untrusted:true}` when that ledger does not verify */
  competition?: import("../domain/startup-recursion").StartupCompetition | { untrusted: true };
  /** "Open this pull request?" (domain/code-publish.ts): the exact title and body Studio will open, and where */
  pullRequest?: PullRequestPreview | null;
  /** a dispatch card's crew (docs/design/crew-seats.md): who runs each node, and the efforts the captain may change for this run only */
  crew?: CardCrew | null;
};
export type CardCrew = { team: string; summary: { en: string; zh: string }; nodes: { node: string; label: string; seat: string; seatLabel: { en: string; zh: string }; provider: string | null; model: string | null; effort: string | null; efforts: (string | null)[] }[] };
export type PullRequestPreview = { repository: string; branch: string; base: string; baseCommit?: string; head: string; draft: boolean; template: { repository: string; path: string; blob: string } | null; title: string; body: string; proven: string[]; proofs?: Record<string, string>; unproven: string[] };
/**
 * The structured detail of an intent-aligned card (additive, optional; unit intent-merge-card). Older cards have none
 * and render from `sections` and `body`. Every text is localized; zh-TW is a real translation (the coordinator writes
 * it) or marked `untranslated` when the coordinator could not, never a placeholder.
 */
export type L10n = { en: string; "zh-TW": string; untranslated?: boolean };
export type CardDetail = {
  /** Additive non-code acceptance metadata; old records remain unchanged. Missing pins require a fresh acceptance card. */
  artifactAcceptance?: { kind: "artifact" | "file-plan" | "lane"; offered: { id: string; n: number; sha256: string | null; format: string; producer: string }[] };
  /** Verified remote merge identity, copied only from the signed request target. */
  remoteTarget?: { version: 1; repository: string; pr: string; branch: string; head: string; base: string; baseHead: string; method: string; grant: string };
  /** the captain's own sentence (en is verbatim) and the lines the captain ticks as met before a non-hold answer */
  intent: L10n; intents: L10n[];
  why: L10n[]; how: L10n[]; scope: { in: string[]; out: string[] };
  /** each done line with its proof: the checks that proved it, their ledger entries, the head they ran on */
  /** the captain's binding changes ("request changes" notes), cumulative; they outrank the done lines (a superseded line says so) */
  amendments?: { n: number; note: string; card: string }[];
  done: { text: L10n; proved: boolean; proofs: { check: string; seq: number; verdict: string; head: string | null; detail: string; evidence: { label: string; href: string }[] }[] }[];
  beforeAfter: { text: L10n; stat: string; images: { label: string; href: string }[] };
  door: { kind: string | null; reason: L10n; rollback: L10n } | null;
  /** mode: how the review was done (diff: read only; run: also executed); notes: what it could not cover (not read, not readable, not executed), for the captain's eye */
  review: { verdicts: { by: string; verdict: string }[]; followups: L10n[]; mode?: string | null; notes?: string[] } | null;
  cost: { usd: number | null; rounds: number; minutes: number | null } | null;
  gates: { name: string; verdict: string; detail: string }[];
  /** the designer round: not applicable (and why), what it looked at (captures), its gate, or its verdicts, the last REJECT's findings, the captures it saw and designer-compare's warnings */
  design?: { applicable: boolean; reason: string; captures: "seen" | "none-env-gap" | "diff-only"; gate?: { verdict: string; detail: string } | null; verdicts: { by: string; verdict: string; head: string | null }[]; findings: { page: string | null; element: string | null; problem: string; change: string }[]; seen: number; compare: { verdict: string; warnings: string[] } | null } | null;
  /** the walk: key hunks of the diff, each serving intents or done lines (0-based indexes) */
  walk: { id: string; file: string; start: number; lines: string[]; note: L10n; serves: { intents: number[]; done: number[] } }[];
  run: string; head: string | null; base: string | null;
  /** who wrote the translations and walk notes: the coordinator agent, or the deterministic fallback (zh marked untranslated) */
  writer: "coordinator" | "fallback";
};
export const emptySections = (): Sections => ({ intent: "", why: "", scope: { in: [], out: [] }, done: [], beforeAfter: "", how: "", glossary: [] });

export class Cards {
  /** Source-owned read-only serialization; never used by get/save/answer. */
  view: (c:SCard)=>SCard = c=>c;
  readonly dir: string;
  onChange: (c: SCard) => void = () => {};
  constructor(dataDir: string) { this.dir = join(dataDir, "cards"); mkdirSync(this.dir, { recursive: true }); }
  private file(id: string) { return join(this.dir, `${id.replace(/[^\w-]/g, "")}.json`); }
  get(id: string): SCard | null { try { return JSON.parse(readFileSync(this.file(id), "utf8")); } catch { return null; } }
  save(c: SCard) { const f = this.file(c.id); writeFileSync(f + ".tmp", JSON.stringify(c, null, 1)); renameSync(f + ".tmp", f); this.onChange(c); }
  list(f: { run?: string; open?: boolean } = {}): SCard[] {
    return readdirSync(this.dir).filter((x) => x.endsWith(".json")).map((x) => { try { return JSON.parse(readFileSync(join(this.dir, x), "utf8")) as SCard; } catch { return null; } })
      .filter((c): c is SCard => !!c && (!f.run || c.run === f.run) && (!f.open || c.status === "open")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  create(c: Omit<SCard, "id" | "status" | "createdAt" | "answer">): SCard {
    if (!(CARD_KINDS as readonly string[]).includes(c.kind)) throw new Error(`unknown card kind ${c.kind}`);
    const card: SCard = { ...c, id: allocate(this.dir, "SC"), status: "open", createdAt: new Date().toISOString(), answer: null };
    this.save(card); return card;
  }
  /** Record an answer, exactly once. One-way merge cards need the door confirmation. A card with intent lines
   *  (detail.intents) takes a non-hold answer only when every line is ticked (`aligned`), or with a note. */
  answer(id: string, a: { choice: string; note?: string | null; by: string; confirm?: string | null; aligned?: number[] | null; localRescope?: LocalRescope | null; crew?: Record<string, string | null> | null }): SCard {
    const c = this.get(id); if (!c) throw new Error("no such card");
    if (c.status !== "open") throw new Error(`this card is ${c.status}: a card is answered exactly once`);
    const opt = c.options.find((o) => o.id === a.choice); if (!opt) throw new Error(`choose one of ${c.options.map((o) => o.id).join(", ")}`);
    if (opt.note && !String(a.note ?? "").trim()) throw new Error(opt.noteLabel ? `write it first: ${opt.noteLabel}` : "say what to change");
    if (opt.select?.length && !opt.select.some((s) => s.value === String(a.note ?? "").trim())) throw new Error(`pick one of ${opt.select.map((s) => s.value).join(", ")}`);
    if (c.confirmDoor && c.door === "one-way" && !opt.hold && a.confirm !== "one-way") throw new Error("a one-way change cannot be undone by a revert: confirm the door first");
    const n = c.detail?.intents?.length ?? 0;
    const aligned = Array.isArray(a.aligned) ? [...new Set(a.aligned.filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((x, y) => x - y) : [];
    if (n && !opt.hold && aligned.length !== n && !String(a.note ?? "").trim()) throw new Error(`tick every intent line as met (${aligned.length} of ${n}), or write a note`);
    if(a.localRescope!=null){const p=a.localRescope;if(a.choice!=="rescope"||p.version!==1||p.card!==c.id||p.visit!==c.visit||typeof p.base!=="string"||!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(p.base)||![p.from,p.target].every(h=>typeof h==="string"&&/^[a-f0-9]{40}$/.test(h))||(p.baseRelation!==undefined&&p.baseRelation!=="patch-equivalent-unadmitted")||(p.strategy!==undefined&&(p.strategy!=="preserve-commits"||p.baseRelation!==undefined||typeof p.originalBase!=="string"||!/^[a-f0-9]{40}$/.test(p.originalBase)))||Object.keys(p).sort().join()!==(p.strategy?"base,card,from,originalBase,strategy,target,version,visit":p.baseRelation?"base,baseRelation,card,from,target,version,visit":"base,card,from,target,version,visit"))throw new Error("invalid local rescope preview");}
    // the captain's efforts for this run (a dispatch card's crew): only nodes the card shows, only efforts it offers, only with a non-hold answer
    if (a.crew != null) { const nodes = c.crew?.nodes ?? []; if (!c.crew || opt.hold || typeof a.crew !== "object" || Array.isArray(a.crew) || Object.entries(a.crew).some(([n, e]) => !nodes.find((x) => x.node === n)?.efforts.includes(e as any))) throw new Error("choose an effort this card offers for each node you change"); }
    c.status = "answered"; c.answer = { choice: a.choice, note: a.note ? String(a.note).slice(0, 4000) : null, by: a.by, at: new Date().toISOString(), confirm: a.confirm ?? null, ...(n ? { aligned } : {}), ...(a.localRescope ? {localRescope: structuredClone(a.localRescope)} : {}), ...(a.crew && Object.keys(a.crew).length ? { crew: { ...a.crew } } : {}) };
    this.save(c); return c;
  }
  /** A deleted run's cards go with it; returns their ids. */
  removeRun(run: string): string[] { const ids = this.list({ run }).map((c) => c.id); for (const id of ids) rmSync(this.file(id), { force: true }); return ids; }
  cancel(id: string) { const c = this.get(id); if (c && c.status === "open") { c.status = "cancelled"; this.save(c); } }
}
