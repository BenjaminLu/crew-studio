// What Studio adds to each captain turn it sends Firstmate (src/host/main.ts turnNote), after the captain's words:
//  - routing (live E2E S3): the deliverables the message asks for and the workflow that makes each, so a request for a
//    document becomes a Documents proposal instead of a file Firstmate writes itself. Nothing when the captain asked
//    Firstmate to do the work itself.
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

/** The turn note Studio appends to a captain message. */
export function firstmateTurnNote(engine: Engine): (text: string) => TurnNote | null {
  const of = workflowForKind(engine);
  return (text) => routingNote(text, of);
}
