# Flowchart (diagram-design's)

Best for decision logic, branching flows, the order a change checks things in.

- Shape carries the type, not colour: an oval (`rx=20`) starts or ends, a rectangle (`rx=6`) is a step, a diamond a
  decision (at most three exits), a small ink dot (`r=4`) where branches rejoin.
- Flow runs top down. From a diamond, Yes to the right and No below by convention, and every exit labelled anyway.
- The accent on the happy path or on the single most consequential decision, never on every decision.
- Two connectors that must cross: a small hop on one.

Anti-patterns: fill colour to say the node's type; a diamond with four or more exits (nest them); unlabelled branches.
