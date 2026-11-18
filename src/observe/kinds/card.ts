// Cards (card:SC-248): what waits for the captain in the Inbox, as the Inbox shows it (engine.cards.view, the /api/scards route's
// own shaping). Reading a card never answers it: no observe tool answers, approves or prepares a card.
import { registerKind, type Entity, type Sources } from "../registry";
import { withheldOf } from "./task";
import type { SCard } from "../../runtime/cards";

/** The Inbox's urgency: a one-way door or a captain-only decision first, then a failed Task's card, then the oldest. */
export const urgency = (c: SCard) => (c.door === "one-way" || c.confirmDoor ? 0 : c.captainOnly ? 1 : c.kind === "failure" || c.failure ? 2 : 3);
/** The urgency as the read tools name it (studio_get card and studio_now say the same words). */
export const urgencyLabel = (c: SCard) => ["one-way door", "captain only", "failure", "decision"][urgency(c)];
export const byUrgency = (a: SCard, b: SCard) => urgency(a) - urgency(b) || String(a.createdAt).localeCompare(String(b.createdAt));

function cardData(s: Sources, c0: SCard, full: boolean): Record<string, unknown> {
  const c = s.engine.cards.view(c0), r = s.engine.get(c.run), withheld = r ? withheldOf(s.engine, r) : null;
  return {
    id: c.id, run: c.run, node: c.node, visit: c.visit, kind: c.kind, status: c.status, createdAt: c.createdAt, workflow: c.workflow,
    door: c.door, confirmDoor: c.confirmDoor, captainOnly: !!c.captainOnly, urgency: urgencyLabel(c),
    options: (c.options ?? []).map((o) => ({ id: o.id, label: o.label, labelZh: o.labelZh ?? null })),
    ...(withheld ? {} : { title: c.title, runTitle: c.runTitle }),
    answer: c.answer ? { choice: c.answer.choice, by: c.answer.by, at: c.answer.at, note: c.answer.note } : null,
    ...(c.failure ? { failure: { class: c.failure.class, code: c.failure.code, title: c.failure.title, meaning: c.failure.meaning, fix: c.failure.fix } } : {}),
    body: full ? c.body : String(c.body ?? "").slice(0, 600),
    links: (c.links ?? []).filter((l) => /^#\//.test(l.href)).map((l) => ({ label: l.label, href: l.href })),
  };
}
const entity = (s: Sources, c: SCard): Entity => {
  const r = s.engine.get(c.run), withheld = r ? withheldOf(s.engine, r) : null;
  return { id: c.id, title: withheld ? `${c.id} ${c.kind} card (its Task's text is withheld)` : `${c.id} ${c.title?.en ?? c.kind}`.slice(0, 100), updatedAt: c.answer?.at ?? c.createdAt ?? null, withheld, project: r ? s.engine.projectRow(r) : null,
    data: cardData(s, c, false), full: () => cardData(s, c, true) };
};

registerKind({
  kind: "card", route: "#/inbox/:id", listRoute: "#/inbox", idPattern: /^SC-\d+$/, idExample: "SC-248",
  about: "A card waiting for the captain (or answered): its kind, Task, options and how urgent it is. Reading one never answers it.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  filters: { open: { type: "boolean", description: "true (default): only cards waiting for the captain; false: every card" }, run: { type: "string", description: "a Task id (R-…)" } },
  fields: [
    ...["id", "run", "node", "visit", "kind", "status", "createdAt", "workflow", "door", "confirmDoor", "captainOnly", "urgency", "options", "title", "links", "withheld",
      "answer.choice", "answer.by", "answer.at", "failure.class", "failure.code", "failure.title", "failure.meaning", "failure.fix"].map((path) => ({ path, trust: "studio" as const })),
    { path: "runTitle", trust: "captain" }, { path: "answer.note", trust: "captain" },
    { path: "body", trust: "untrusted", source: "the card's body, written by the Task's agents" },
  ],
  list: (s, filter) => s.engine.cards.list(filter.open === false ? {} : { open: true }).filter((c) => (!filter.run || c.run === filter.run) && (() => { const r = s.engine.get(c.run); return !!r && !r.archived; })()).sort(byUrgency).map((c) => entity(s, c)),
  get: (s, id) => { const c = s.engine.cards.get(id); return c ? entity(s, c) : null; },
});
