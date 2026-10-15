# Unit graph-simple-view: a simple default view of a workflow

What: the workflow graph opens in a **Simple** view: only the main path through the stages,
with loops, the door question and escalations as badges. A **Detail** toggle shows everything
(the graph-tidy layout with every back edge and escalation node) and stays the editing mode.

Why: the captain found the tidy graph still too busy: long dashed back edges to the top,
escalation edges fanning across stages, edges behind the minimap, a fit view full of dashed
boxes. Folds in the graph-tidy review round 1 findings (docs/units/graph-tidy.md, lines 3, 8,
10 and 11).

## How

- `crewLayout.simplify(def)` (public/graph-layout.js):
  - loop nodes (kind `loop`) are hidden; their producer gets a "↻ refine" or "↻ fix" badge
    with the round cap (`args.round_cap`, else the runtime's default 3); a loop's `pass` edge
    becomes its producer's;
  - the kept nodes are the ones on a forward path from the entry to the end (back edges, as
    graph-tidy classifies them, are dropped): for code-firstmate intake, worktree, spec,
    dispatch, door, plan, accept plan, build, CI, review, merge card, merge, after merge,
    clean up, merged (15);
  - a node whose only way on is back to the node it came from (Pick the door) folds into that
    node's badge ("? asks you if unsure");
  - every other hidden node (step-back, stalled, budget, scope, parked, closed, dropped) is an
    escalation: one "⚑ N escalations" badge on each stage it leaves from (walking back through
    other escalations and loops), or on the node when there are no stages; the badge lists them.
- `crewLayout.layoutSimple(def, { wrap })` lays the simple graph out with the graph-tidy
  layout, in bands of at most `wrap` columns (a stage is never split unless it alone is wider),
  rows 128 apart with a badge row under each node; an edge into the next band runs down the
  right margin, along the gap between bands and into its target from the left. The editor
  picks `wrap` from the canvas width so that node titles (15 units) render at 11 px or more at
  Fit. The door forks in two (one-way → Plan, two-way → Build) and rejoins at Build.
- Badges in the simple view hang under the node (checks, loops, the folded question,
  escalations) so titles keep their room; a stage's escalations sit on its title row. In the
  live view a loop badge shows the current round ("↻ refine · round 2/3", from the producer's
  visits).
- Labels avoid nodes, stage titles, other labels and other edges; they take no pointer events.
- Simple is the default (remembered per browser, `crew.graphView`) in the editor and the run
  view. In Simple the palette is replaced by a note pointing to Detail view; ports are hidden;
  a node can still be dragged (its edges follow) but the simple view's positions are not kept.
  Detail view keeps graph-tidy's behaviour (auto or manual layout, Tidy, minimap).
- The minimap is docked under the canvas, on the left (the chat button sits bottom right), in
  Detail view only: the simple view fits whole. The canvas refits when it changes size (the chat
  opening or closing). Detail view opens at 1 unit a pixel, so node text is legible without Fit.

## Done lines

`tests/graph-tidy.ts` and `tests/graph-tidy-ui.mjs` (both also carry graph-tidy's lines).

1. Simple-view node count: "the simple view of code-firstmate holds only the main path through
   the stages (15 nodes)"; UI "the simple view is the default and shows the main path (15
   nodes)".
2. No back edges and no escalation edges in simple view: "no back edges and no escalation
   edges in simple view: <id> (simple, wrap N)" (every built-in workflow, wrap 6 and 2), "loop,
   door-question and escalation nodes are hidden in simple view"; UI "no back edges and no
   escalation edges in simple view".
3. Badges: "loops become ↻ badges with their round cap", "Pick the door folds into the Door
   node's badge", "escalations become one badge per stage they leave from"; UI "the badges show
   the loops (with their cap), the door question and the escalation counts", "an escalation
   badge lists its escalations", "in the live view the loop badge shows the current round".
4. The door fork: "the door forks in two (one-way → Plan, two-way → Build) and rejoins at
   Build".
5. Toggle: UI "toggling to Detail view restores every node, back edge and port", "back in the
   simple view: the main path again, editing points to Detail view", "the run view shows the
   same simple view, with node states", "the run view's Detail view uses the same tidy layout, with node states".
6. Minimap: UI "the minimap does not cover any node or edge" (Detail view; element boxes
   clipped to the canvas), "the simple view fits whole and needs no minimap".
7. Labels and legibility: "edge labels sit on no node, stage title, other label or other edge:
   <id> (simple, wrap N)"; UI "node titles render at 11 px or more in the simple view at Fit
   (1440)" (the smallest rendered `.rt-label`).
8. Geometry of the simple view: "no node overlaps a node", "no edge passes through a node" for
   every built-in workflow at wrap 6 and 2.
9. Screenshots of simple, simple-fit and detail at 1440 and 390, light and dark: graph-tidy
   line 10.

## Fail-first

On graph-tidy's head `f699f9c`, with only the new tests copied in: `bun tests/graph-tidy.ts`
45 passed, 3 failed ("the simple view lays every built-in workflow out" and "the simple view
of code-firstmate": `layoutSimple` does not exist; "a version with a layout saved before this
change opens in manual mode"); `node tests/graph-tidy-ui.mjs` wrote the before screenshots,
then stopped waiting for the simple view (timeout). "its stage collapses like a built-in one",
"a node that names its own stage is boxed in it" and the crossings-half assertion pass there:
they cover graph-tidy behaviour that already worked.

Changed tests: `tests/runtime-ui.mjs` switches to Detail view before editing and uses a
1440×1500 viewport, because the palette now sits under the wider canvas at 1440 and its
drag-and-drop needs both on screen.
