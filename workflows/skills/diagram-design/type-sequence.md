# Sequence (diagram-design's)

Best for request/response flows, multi-actor exchanges over time, retries and branches.

- Actors as boxes in a row at the top; dashed lifelines down from each. Time flows top to bottom; never an arrow upward.
- One event a band: about 48px of height for each; a self-call with a guard and a result is three events.
- Messages: a call (sync) solid, `link` or `muted`, filled head; a return dashed, filled head; async fire-and-forget dashed
  with an open head; one headline success in `accent`, at most two.
- A branch is a combined fragment frame (`alt` with up to two regions, `opt`, `loop`) spanning only the lifelines in it,
  its operator in a mono tab at the top left, the guard under it; regions divided by a dashed hairline. Never free-floating
  if/else arrows. One fragment a figure (two only if each is a single-region `opt`/`loop`), nesting one deep at most.
- Budgets: 5 lifelines, 12 messages. Past them, an overview (the happy path) and a detail (the failure or retry path).

Anti-patterns: labels sitting over another lifeline; a frame covering actors with no messages in it; the accent on both
branches of an `alt`; an open head on a return.

Through board_draw, a `sequence` item takes `actors` and `steps` ({from, to, label, kind: call|return|async, frame?:
loop|alt|else|opt, frameLabel?}) and Studio draws it by these rules.
