# The lesson's shapes, exactly (baton's packet spec, adapted to the review room)

baton fills a page from one JSON file. In the review room the page is the lesson report, and its sections are your scenes:
scene_show adds one, board_draw adds the drawing it shows, chapter_skip leaves a chapter out with a cited reason,
lesson_check says what is still missing. Studio renders it all: the outline rail, the sections, every figure, the
citations (each opens the code, the diff, the commit or the note it rests on, at this head), the three languages.

## A section (scene_show)

`{chapter, title, picture?, points: [{text, cites}]}`: the chapter (any order; the report keeps the chapters' order); a short title; the board item it shows (a
text chapter, what / reviewers / roads / watch / questions, may have none); 2 to 4 points of one sentence each, every point
with the citations it rests on (`diff:path:Lstart-end`, `commit:<sha>`, `review:<id>`, `ledger:#seq`, `source:<n>`,
`board:<id>`). A point without a verified citation shows as an inference.

## Drawings (board_draw items)

- `arch`: `{type: "arch", title, nodes: [{id, label, kind: service|store|external|queue|actor, mark?: new|changed|removed}],
  edges: [{from, to, label?, cite?}], cites?}`: 2 to 12 nodes, 1 to 20 edges between them.
- `decision`: `{type: "decision", title, question, chosen, because, rejected?: [{option, why, cite}], cites}`: at most 3
  rejected options, each cited to a commit, a review note, the ledger or a source.
- `item`: `{type: "item", title, name, before, after, mechanism?, cites}`.
- `states`: `{type: "states", title, entity, states: [{id, label, mark?: "new"|"changed"}], transitions: [{from, to, label, detail?, cite, tx?}]}`:
  2 to 10 states, 1 to 16 transitions; `tx` = `{tables: [{table, op: INSERT|UPDATE|DELETE|UPSERT, guard?, fields: [{k,
  was?, now}]}], outside?: [{what, kind?: cache|call|event|file|queue}]}`.
- `calls`: `{type: "calls", title, calls: [{name, method?, request: [{k, v}], response: [{k, v}], errors?: [{code, when}],
  tx?, cite}]}`: 1 to 6 calls.
- A figure you draw: `figure_svg {kind: state|sequence|architecture|flow|decision|item, title, svg, entity?, cites?,
  transitions?: [{edge: "from>to", label, cite, tx}]}` (a state figure lists every `data-edge` it draws). The SVG follows
  workflows/skills/diagram-design/output-spec.md.
- `sequence`: `{type: "sequence", title, actors: [names], steps: [{from, to, label, kind?: call|return|async, frame?:
  loop|alt|else|opt, frameLabel?}], cites}`: 2 to 6 actors, 1 to 16 steps.

## Leaving a chapter out (chapter_skip)

`{chapter: talks|lifecycle|sequence, reason, cites}`: one sentence, cited to what shows there is nothing for it. The
captain reads the reason in the report where the drawing would be; it counts as one of the turn's scenes.

## Before your final answer (lesson_check)

`{}` → `{ok, missing}`. Studio refuses a lesson with anything missing, so fix it first.
