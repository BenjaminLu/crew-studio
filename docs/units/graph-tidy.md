# Unit graph-tidy: a readable workflow graph

What: the workflow graph (the editor at `#/workflows/<id>` and the live view at `#/run/<id>`)
gets an automatic layered layout, back edges drawn as arcs outside the main lane, collapsible
stage boxes, checks and gates as count badges, routed edges with arrowheads and labels that
do not overlap, and Tidy / Fit to view / minimap controls.

Why: the captain: 「現在v2的workflow線圖也太亂了 能不能整理一下」. The before screenshots
(`tests/out/graph-tidy/before/`) show nodes at hand-placed positions, back edges cutting
through nodes, labels on top of each other and a canvas that does not fit.

## How

- `public/graph-layout.js` (no dependency, also loaded by the tests) lays a definition out
  left to right, Sugiyama style:
  1. a depth-first walk from the entry, children in definition order, splits the edges into
     forward edges and back edges (an edge to a node on the walk's stack);
  2. ranks: the longest path over forward edges, then each stage's nodes are pushed right of
     the stage before it, so every stage occupies its own columns;
  3. the main path (the longest path from the entry to the furthest end) is the middle lane,
     row 0; a forward edge longer than one column gets a placeholder in every column it
     crosses;
  4. order in each column: barycentre sweeps (down and up, four times), with a stage's nodes
     kept together and other nodes placed outside that block; rows are assigned around the
     main lane;
  5. a fixed grid: columns 230 px apart (node 150 + an 80 px channel), rows 96 px apart.
- Edges: a forward edge between neighbouring columns is a curve inside the channel between
  them; a longer one passes through its placeholders. A back edge leaves its node into the
  channel to its right, rises (or drops) to its own level above (or below) all nodes and
  stage boxes, runs across, and comes down the channel to its target's left: never through a
  node. Back edges on the same side get levels by interval colouring, so two arcs that overlap
  in x never share a level. Back edges are dashed and carry their label on the arc. Outgoing
  and incoming edges spread along a node's side; branch labels (one-way / two-way …) sit at
  the fork, next to the source, and a label that would overlap another moves along its edge.
- Stages: built-in stage tables (for `code-firstmate`: Intake, Door, Plan, Build loop, Gates,
  Merge, After merge; a node may also name its `stage`) draw titled boxes. A stage collapses
  into one box (click its title or press Enter on it); the layout reruns on the collapsed
  graph. Expanded by default on a desktop, collapsed on a phone (≤ 640 px). In the live view a
  collapsed stage shows its state: running if any member runs, failed if any failed, done when
  all passed.
- Badges: a node's checks show as "N checks", an edge's checks as "N gates"; clicking one
  lists them, clicking again closes the list.
- Layout mode per version: a workflow version shows the auto layout until someone drags a
  node; then its positions are kept (`POST /api/wf/<id>/layout`, as before) and the version is
  marked manual (`data/graph-layout.json`, `GET|POST /api/graph-layout/<id>/v<N>`). A version
  with a layout file from before this change and no entry is manual. "Tidy layout" stores an
  explicit auto. The live view always uses the auto layout. (Detail view; see
  docs/units/graph-simple-view.md for the default simple view.)
- Controls: Tidy layout, Fit to view (fits the whole graph in the canvas), zoom, and a
  minimap on a desktop (click or drag in it to move the view).

## Done lines

Each names its test. `tests/graph-tidy.ts` (the layout module, on every built-in
workflow: `code-firstmate` and `refine-demo` from the bundled definitions, and `documents`,
`file-organization`, `trivial-lane`, `video`, `web-prototype` from fixtures exported from a
live Studio) and `tests/graph-tidy-ui.mjs` (the pages) are new.

1. No two nodes overlap, on every built-in workflow, expanded and with every stage
   collapsed: "no node overlaps a node: <id>".
2. No edge passes through a node, computed geometrically on the rendered edge shapes
   (curves sampled): "no edge passes through a node: <id>"; in the browser, sampled with
   `getPointAtLength` on the drawn paths: UI "no drawn edge passes through a node".
3. Crossings at or below the threshold measured on the new layout, and at most half the hand
   layout's (measured with the same function): "edge crossings ≤ threshold, and at most half
   the hand layout's: <id>".
4. Back edges are arcs outside the node band, dashed, with their label on the arc: "back
   edges are arcs above or below every node: <id>"; UI "back edges are drawn as dashed arcs".
5. No two edge labels overlap: "no edge labels overlap: <id>".
6. Stages: "every code-firstmate node of a named stage is inside its box, and no other node
   is", "stage boxes do not overlap"; UI "a stage collapses into one box and expands again",
   "on a phone the stages start collapsed", "a collapsed stage shows its state in the live
   view".
7. Badges: UI "checks and gates show as count badges", "a badge opens its list".
8. Controls and modes: UI "a newly loaded built-in workflow uses the auto layout", "a dragged
   node keeps its place after a reload (manual mode)", "Tidy layout returns to the auto
   layout", "Fit to view shows the whole graph", "the minimap moves the view". A version whose
   positions were dragged before this change (a `layout-v<N>.json` with no layout-mode entry)
   opens in manual mode, and its first drag keeps every other saved position: API "a version
   with a layout saved before this change opens in manual mode (no saved layout: auto)",
   "Tidy layout's explicit auto wins over the old saved layout"; UI "a version with a layout
   saved before this change opens in manual mode with its positions", "the first drag keeps
   every other saved position".
9. Live view: UI "the run view shows the same simple view, with node states" (the node set of
   the simple layout, each with its state), "the run view's Detail view uses the same tidy
   layout, with node states" (positions equal to the editor's auto layout, states as the run reports them), "a collapsed stage shows its state in
   the live view", "in the live view the loop badge shows the current round".
10. Screenshots, written by `tests/graph-tidy-ui.mjs`: before (each workflow's hand layout,
    shown in manual mode, `tests/out/graph-tidy/before/`) and after (`tests/out/graph-tidy/after/`:
    simple, simple at Fit, and detail), at 1440 and 390 px, light and dark, every built-in
    workflow, no sideways page scroll: UI "before screenshots of the hand layouts exist for every
    workflow, 1440 and 390, light and dark", "<id> renders at <width> <scheme> (<view>)".
11. A node may name its own `stage`: "a node that names its own stage is boxed in it", "its
    stage collapses like a built-in one".

## Measured

Crossings (pairs of edges that cross, edges sharing a node not counted), measured with the
same function: `code-firstmate` 17 on the tidy layout against 57 on the hand layout; every
other built-in workflow 0 (the hand layout of `trivial-lane` had 1). The thresholds in
`tests/graph-tidy.ts` are these measurements.

## Fail-first

Base `56e8de9` (the branch was then rebased onto `1dbf12a`, its merge-base now), with only the new tests and fixtures copied in:
- `bun tests/graph-tidy.ts`: 0 passed, 1 failed (`public/graph-layout.js` does not exist), so
  its lines are red by construction.
- `node tests/graph-tidy-ui.mjs`: "a newly loaded built-in workflow uses the auto layout"
  FAIL; "no drawn edge passes through a node" FAIL with real hits on the hand layout
  (`spec→spec-fix` through Refine spec, `spec-fix→spec` through Spec, `spec-fix→scope-card`
  through Pick the door, …); "back edges are drawn as dashed arcs" FAIL (none); then the stage
  toggle does not exist (timeout).
