# diagram-design, for the review room's figures

Adapted from diagram-design (see NOTICE.md in this folder). In the review room a figure you draw yourself goes through the
`figure_svg` tool: you write one SVG by these rules, inside baton's embedding contract, and Studio checks it before the
captain sees it. When you would rather give structure than geometry, board_draw's `arch`, `states`, `sequence`, `item`,
`decision` and `calls` items are laid out by Studio under the same rules.

## Philosophy

The highest-quality move is usually deletion. Every node is a distinct idea; two nodes that always travel together are one
node. Every connection carries information; if layout already says it, remove the line. The accent is editorial, not a
flag: one or two focal elements a figure. Target density 4 of 10. Above nine nodes it is probably two figures.

## Selection: semantic pattern, then visual type

When behaviour, state, enforcement or risk carries the meaning, choose one semantic pattern first (`semantic-patterns.md`),
then the nearest visual type for the layout. The types the room uses:

| You are showing | Type | Reference |
|---|---|---|
| Components and connections | architecture | `type-architecture.md` |
| Decision logic with branches | flowchart | `type-flowchart.md` |
| Time-ordered messages between actors | sequence | `type-sequence.md` |
| States, transitions and guards (a lifecycle) | state machine | `type-state.md` |
| Who does what at each step of a pipeline | data flow | `type-data-flow.md` |

If a three-column table says the same thing, use the table. If you are past the budget, split into an overview and a detail.

## Anti-patterns (each one fails)

Identical boxes for every node; a legend floating inside the figure; an arrow label without a mask, or sitting on its line;
the accent on every important node; a diagonal connector between nodes that share neither x nor y; two connectors on one
stroke; two connectors on one attach point; a connector behind a box that is not one of its ends; vertical text; shadows;
radius over 10.

## Design system (the room's palette)

Colours are roles, written only as `var(--fig-<role>)`; Studio maps each to the room's light and dark colours:

| Role | Use |
|---|---|
| `paper`, `card`, `card-2` | background, box fill, container fill |
| `ink` | primary text and strokes |
| `muted`, `soft` | secondary text, default arrows, sublabels |
| `rule`, `rule-strong` | hairlines |
| `accent`, `accent-tint` | this change: one or two focal elements |
| `ok`, `ok-tint` | new, or an end that went well |
| `amber`, `amber-tint` | needs attention, a way back |
| `seal`, `seal-tint` | cannot be undone, an end that failed |
| `link` | HTTP or API calls, external arrows |

Node treatment: focal = `accent-tint` fill, `accent` stroke; a step or service = `card` fill, `ink` stroke; a store =
`card-2` fill, `muted` stroke; external = `card-2` fill, `soft` stroke dashed `5,4`; optional or async = dashed. Fonts only
`var(--fig-sans)` (names), `var(--fig-mono)` (identifiers, ports, fields), `var(--fig-serif)` (a callout).

## Connector rules (mandatory)

1. Orthogonal connectors with rounded corners (`r=8`; a quadratic at each bend); a straight line only between nodes that
   share an x or a y. Never a diagonal.
2. A label sits 6–10px off its connector, never on it, with an opaque mask (`rect fill="var(--fig-paper)"`) behind it.
3. No two connectors on one stroke; parallel connectors at least 12px apart; a crossing gets a hop on the less important one.
4. Connectors on the same side of a box each get their own attach point, spread evenly (`L × k / (N + 1)`), at least 12px
   apart.
5. A connector never passes behind a box that is not one of its ends: route around it.
6. A label's mask never overlaps a box drawn after it.

Draw connectors before boxes. Arrowheads are markers you define in `<defs>`, referenced as `url(#id)`.

## Layout

4px grid: every coordinate, size and gap divisible by 4. Node sizes from 80 to 320; gaps 20 to 48; radius 4 to 8. Budgets:
at most 9 nodes and 12 connectors a figure (a lifecycle: every state and every transition the code has; split it by
entity, not by leaving transitions out); a sequence at most 5 lifelines, 12 messages and one fragment (two single-region
`opt`/`loop`). The canvas grows from the content: lay out top down, then set the viewBox height.

## Before you send it (the gate Studio runs, and what eyes would)

Studio refuses a figure whose labels overlap, whose label sits on a line, whose connector passes through a box that is not
one of its ends, whose label leaves the viewBox, whose Chinese text is under 12px, or whose label lacks `data-en`,
`data-hant` and `data-hans`; it drops every element and attribute off its allowlist and tells you which. Check yourself
too: can a node, an arrow or a label go? Is the accent on at most two elements? Is every connector traceable end to end?
