/** A round is stopped before its agent starts, with a reason the workflow can route (e.g. to a card). */
export class RoundBlocked extends Error { outcome = "blocked"; constructor(m: string) { super(m); } }
