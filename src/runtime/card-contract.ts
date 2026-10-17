// The card contract (retro 2026-10-17, finding 10): every captain card answers the stuck question.
// - the title states the question (never a generic status such as "Round is not ready");
// - the body states the problem and its context (body or why, never empty);
// - every option has an id, an English label and a zh-TW label, and an option that needs text
//   (rescope, request changes, revise, another model, an answer) opens a note box or a picker;
// - no null, undefined or empty field reaches the captain, and no internal reason string either
//   (exception class names, failure codes, policy keys, run-state paths, stack lines).
// engine.card checks every card it raises: in tests (CREW_CARD_CONTRACT=enforce, set by
// the test guard in tests/lib) a violation throws; in production it is logged on the run.
import type { SCard } from "./cards";

/** Option ids that ask for text: they need a note box (or a picker) on the card. */
export const TEXT_OPTIONS = new Set(["rescope", "changes", "request", "revise", "other-model", "answer", "edit-params"]);
/** Titles that name a state, not the question; they were the ones the captain could not act on. */
const GENERIC_TITLES = /^(round is not ready|artifact needs attention|render unavailable|mp4 not verified|creation needs attention|captain ready\b.*)$/i;
/** What only leaks from code: a missing value printed (alone, or as "undefined" anywhere), or an object printed whole. */
const EMPTY_WORDS = /^\s*(null|undefined|NaN)\s*$|(^|[^\w-])undefined([^\w-]|$)|\[object Object\]/;
/** Internal reason strings: exception classes, failure codes, policy keys, run-state paths, stack lines. */
const INTERNAL = /\b(QueueRefusal|ProviderRefusal|FailureError|FailureRefusal|TypeError|ReferenceError|nativeQueue\w*|retryAction|closeAction|(internal|deterministic|transient|environment)\.[a-z][a-z-]+|queue\.(global_capacity|project_capacity|wait_timeout_s)|wait_timeout_s|x\.ctx\.|r\.ctx\.|rn\.data|ctx\.[a-zA-Z]+\.[a-zA-Z]+)\b|\bat [\w.<>]+ \([^)]*\.[tj]s:\d+/;

const text = (v: unknown) => (typeof v === "string" ? v : "");
/** Every violation of the card contract, in plain words (empty: the card keeps the contract). */
export function cardContract(c: Pick<SCard, "title" | "sections" | "body" | "options"> & { kind?: string; links?: SCard["links"] }): string[] {
  const out: string[] = [];
  const en = c.sections?.en, zh = c.sections?.["zh-TW"];
  const title = { en: text(c.title?.en).trim(), zh: text(c.title?.["zh-TW"]).trim() };
  if (!title.en) out.push("the title is empty (en)");
  if (!title.zh) out.push("the title is empty (zh-TW)");
  if (title.en && GENERIC_TITLES.test(title.en)) out.push(`the title "${title.en}" names a state, not the question the captain answers`);
  if (!text(c.body).trim() && !text(en?.why).trim()) out.push("the body is empty: it states neither the problem nor its context");
  const opts = Array.isArray(c.options) ? c.options : [];
  if (!opts.length) out.push("the card has no option to answer with");
  const ids = new Set<string>();
  for (const o of opts) {
    const id = text(o?.id);
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/i.test(id)) out.push(`option "${id}" has no valid id`);
    if (ids.has(id)) out.push(`option "${id}" appears twice`); ids.add(id);
    if (!text(o?.label).trim()) out.push(`option "${id}" has no label (en)`);
    if (!text(o?.labelZh).trim()) out.push(`option "${id}" has no label (zh-TW)`);
    if (TEXT_OPTIONS.has(id) && !o?.note && !(o as any)?.select?.length) out.push(`option "${id}" needs text but opens no note box`);
    if ((o as any)?.select !== undefined && (!Array.isArray((o as any).select) || !(o as any).select.length || (o as any).select.some((s: any) => !text(s?.value).trim() || !text(s?.label).trim()))) out.push(`option "${id}" has an empty picker`);
  }
  // the body may quote the captain's own words or a diff: only a printed object is refused there
  if (/\[object Object\]/.test(text(c.body))) out.push("the body shows a missing value: [object Object]");
  const shown: [string, string][] = [["title (en)", title.en], ["title (zh-TW)", title.zh],
    ["why (en)", text(en?.why)], ["how (en)", text(en?.how)], ["why (zh-TW)", text(zh?.why)], ["how (zh-TW)", text(zh?.how)],
    ...opts.flatMap((o): [string, string][] => [[`option ${o?.id} (en)`, text(o?.label)], [`option ${o?.id} (zh-TW)`, text(o?.labelZh)]])];
  for (const [where, t] of shown) {
    if (EMPTY_WORDS.test(t)) out.push(`${where} shows a missing value: ${JSON.stringify(t.slice(0, 120))}`);
    const m = INTERNAL.exec(t); if (m) out.push(`${where} shows an internal reason string (${m[0]})`);
  }
  for (const [l, s] of [["en", en], ["zh-TW", zh]] as const) {
    if (!s) continue;
    if ([...(s.scope?.in ?? []), ...(s.scope?.out ?? []), ...(s.done ?? [])].some((v) => !text(v).trim())) out.push(`the ${l} scope or done list has an empty line`);
  }
  for (const k of c.links ?? []) if (!text(k?.label).trim() || !text(k?.href).trim()) out.push("a link has no label or no address");
  return [...new Set(out)];
}

/** The mode the engine checks cards in: enforce (throw), else log. Tests run with enforce. */
export const cardContractMode = () => (process.env.CREW_CARD_CONTRACT === "enforce" ? "enforce" : "log");
