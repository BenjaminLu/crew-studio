// What Studio adds to each captain turn it sends Firstmate (src/host/main.ts turnNote), after the captain's words:
//  - routing (live E2E S3): the deliverables the message asks for and the workflow that makes each, so a request for a
//    document becomes a Documents proposal instead of a file Firstmate writes itself. Nothing when the captain asked
//    Firstmate to do the work itself.
//  - live status (S10): the cards waiting for the captain and the Tasks running, read when the turn is sent. Firstmate
//    listed answered cards as "waiting for you" from memory of earlier turns; its status claims come from this line
//    or from studio_work_status read in the same turn.
import { routeRequest } from "./deliverables";
import { workflowForKind } from "./firstmate";
import type { Engine } from "./runtime/engine";
import type { TurnNote } from "./host/main";

/** The routing line for one captain message, or null when it names no deliverable (or asks for hands-on work). */
export function routingNote(text: string, workflowOf: (kind: string) => string | null): TurnNote | null {
  const routes = routeRequest(text, workflowOf).map(({ asks, workflow }) => ({ asks, workflow }));
  if (!routes.length) return null;
  const list = routes.map((r) => `${r.asks} → ${r.workflow}`).join("; ");
  return { routes, text: `[Studio note: this message asks for ${list}. Each deliverable becomes a proposal on its workflow (studio_propose_work; the captain approves the card). Do the work hands-on yourself only if the captain explicitly asks you to.]` };
}

const STATUS_SHOWN = 8;
const quoted = (t: unknown) => JSON.stringify(String(t ?? "").replace(/\s+/g, " ").slice(0, 48));
/** One line: what waits for the captain and what runs, now. Never empty: "nothing waits for you" is a status too. */
export function liveStatus(engine: Engine): string {
  const open = engine.cards.list({ open: true }).filter((c) => { const r = engine.get(c.run); return !!r && !r.archived; });
  const waiting = open.slice(0, STATUS_SHOWN).map((c) => { const r = engine.get(c.run)!; return `${r.id} ${r.workflow} ${quoted(r.title)} (${c.kind} card ${c.id}: ${quoted(c.title.en)})`; });
  const busy = new Set(open.map((c) => c.run));
  const running = engine.list().filter((r) => !r.archived && !busy.has(r.id) && ["queued", "running", "waiting", "paused"].includes(r.status));
  const runs = running.slice(0, STATUS_SHOWN).map((r) => `${r.id} ${r.workflow} ${quoted(r.title)} ${r.status}`);
  const more = (n: number) => (n > STATUS_SHOWN ? `, and ${n - STATUS_SHOWN} more` : "");
  return `[Studio note: live status at this message: ${waiting.length ? `waiting for the captain: ${waiting.join("; ")}${more(open.length)}` : "nothing waits for the captain"}. ${runs.length ? `Running: ${runs.join("; ")}${more(running.length)}` : "Nothing is running"}. Any status you tell the captain comes from this line or from studio_work_status read in this turn, never from earlier turns.]`;
}

/** The turn note Studio appends to a captain message: the route of what it asks for, then the live status. */
export function firstmateTurnNote(engine: Engine): (text: string) => TurnNote | null {
  const of = workflowForKind(engine);
  return (text) => {
    const route = routingNote(text, of);
    let status = ""; try { status = liveStatus(engine); } catch { status = ""; }
    const parts = [route?.text, status].filter(Boolean) as string[];
    return parts.length ? { text: parts.join("\n\n"), routes: route?.routes ?? [] } : null;
  };
}
