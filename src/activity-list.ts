// The Activity page's list, filtered and paged here (public/list-tools.js, server mode): firstmate's event log has no cap,
// so the page never filters only the newest events it happened to load.
//   GET /api/activity?page=N&size=25|50|100[&sort=old][&q=words][&type=v…][&actor=v…][&task=v…][&tok.type=prefix…]
//     → { rows, matched, total, counts: { type: {value: n}, actor: {…}, task: {…} } }
// A free word matches the event's summary and activity (both languages), type, actor and task, in either Chinese script
// (opencc-js, as the page converts). A checked value matches exactly; a key:value word (tok.<key>) from its start.
// Each facet's counts are the events left if that value were ticked as well: every other filter applied.
import { Converter } from "opencc-js/t2cn";
import type { Ev } from "./fm";

const toCN = Converter({ from: "twp", to: "cn" });
const norm = (s: string) => toCN(String(s ?? "")).toLowerCase();
const KEYS = ["type", "actor", "task"] as const;
type Key = (typeof KEYS)[number];
export type ActivityQuery = { q: string; f: Record<Key, string[]>; tok: Record<Key, string[]>; page: number; size: number; sort: "new" | "old" };
const SIZES = [25, 50, 100];

/** the query a request asks for */
export function activityQuery(u: URLSearchParams): ActivityQuery {
  const f = {} as Record<Key, string[]>, tok = {} as Record<Key, string[]>;
  for (const k of KEYS) { f[k] = u.getAll(k).filter(Boolean); tok[k] = u.getAll(`tok.${k}`).filter(Boolean).map(norm); }
  const size = Number(u.get("size")); const page = Math.max(1, Math.floor(Number(u.get("page")) || 1));
  return { q: u.get("q") ?? "", f, tok, page, size: SIZES.includes(size) ? size : 25, sort: u.get("sort") === "old" ? "old" : "new" };
}

const hay = new WeakMap<Ev, string>();
function textOf(e: Ev): string {
  let s = hay.get(e); if (s !== undefined) return s;
  s = norm([e.summary?.en, e.summary?.["zh-TW"], e.activity?.en, e.activity?.["zh-TW"], e.type, e.actor, e.task].filter(Boolean).join("\n"));
  hay.set(e, s); return s;
}
const valueOf = (e: Ev, k: Key): string | null => (k === "task" ? e.task : k === "type" ? e.type : e.actor) || null;

/** One page of the events that match, how many match, how many there are, and every facet's counts. */
export function activityPage(events: readonly Ev[], q: ActivityQuery) {
  // a word, or a phrase in double quotes (the toolbar sends a quoted phrase as one)
  const free = (q.q.match(/"[^"]*"|\S+/g) ?? []).map((w) => norm(w.replace(/^"|"$/g, "")).trim()).filter(Boolean);
  const facet = (e: Ev, k: Key) => { const s = q.f[k], t = q.tok[k]; if (!s.length && !t.length) return true; const v = valueOf(e, k); if (!v) return false;
    return s.includes(v) || t.some((w) => norm(v).startsWith(w)); };
  const counts = { type: {}, actor: {}, task: {} } as Record<Key, Record<string, number>>;
  const matched: Ev[] = [];
  for (const e of events) {
    if (free.length) { const s = textOf(e); if (!free.every((w) => s.includes(w))) continue; }
    const pass = KEYS.map((k) => facet(e, k)), fails = pass.filter((x) => !x).length;
    if (!fails) matched.push(e);
    if (fails > 1) continue;
    KEYS.forEach((k, i) => { if (fails === 1 && pass[i]) return; const v = valueOf(e, k); if (v) counts[k][v] = (counts[k][v] ?? 0) + 1; });
  }
  if (q.sort === "new") matched.reverse();
  const pages = Math.max(1, Math.ceil(matched.length / q.size)), page = Math.min(q.page, pages);
  return { rows: matched.slice((page - 1) * q.size, page * q.size), matched: matched.length, total: events.length, page, counts };
}
