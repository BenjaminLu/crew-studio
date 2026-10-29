# Data flow (diagram-design's)

Best for who does what at each step of a pipeline: role lanes across, steps along, the hand-offs between them.

- Steps are columns with a header chip; roles are lanes; a node sits where a role meets a step.
- Arrows by meaning, not colour choice: a standard hand-off `muted`; a governance trigger `muted` dashed `4,3`, unlabelled;
  the one focal cross-role hand-off `accent`, labelled with what it carries; a published output `link`.
- Routing: horizontal first, then vertical; leave a node by its right edge, enter by its left (same lane) or its top or
  bottom (another lane); bends with an 8px curve; never a diagonal. Only the focal arrow is labelled, on a paper mask.
- One focal step, one focal node, one focal arrow. Up to three other nodes may carry a semantic colour (security, quality,
  lineage, archive); arrows never take a custom colour.
- A legend strip at the bottom, under a hairline, never inside the figure.
