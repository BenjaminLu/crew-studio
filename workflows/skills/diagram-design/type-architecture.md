# Architecture (diagram-design's)

Best for what talks to what: system overviews, integration maps, the components a change touches.

- Group components by tier or trust boundary (client → service → data; public → private). Pick one primary direction
  (left to right or top down) and hold it.
- Draw connectors before boxes. One or two focal nodes in `accent` (what the change touches); a new one in `ok`; a removed
  one in `seal`, dashed; what is outside the change in `soft`, dashed.
- Connectors orthogonal with rounded corners (`r=8`): a two-bend elbow `M x1,y1 H mid-8 Q mid,y1 mid,y1+8 V y2-8 Q mid,y2
  mid+8,y2 H x2`. A straight line only when the ends share an x or a y. When the destination is above or below, leave and
  enter by the top or bottom edge.
- Dashed connectors (optional, async, return) follow the same routing. At a crossing, hop the less important one
  (`a 8,8 0 0,1 16,0`).
- A zone (a boundary) is a faint rectangle drawn first, its label on a paper mask; at most three zones.
- Shape carries meaning: a store, a queue, an external system each look different; do not settle for identical boxes.

Anti-patterns: every box in the accent; a two-way arrow where one direction is obvious; a legend inside the figure.

Through board_draw, an `arch` item takes `nodes` ({id, label, kind: service|store|external|queue|actor, mark?:
new|changed|removed}) and `edges` ({from, to, label?, cite?}) and Studio lays it out by these rules.
