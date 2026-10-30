# Drawings (baton's diagrams guidance, adapted to the review room)

## Who draws

**Look for a design document first.** `design*.md`, `docs/**`, `*spec*.md`, an architecture note in a README: read them
with fs_search and fs_read. When one carries a diagram, that is the structure to use; its author already modelled the
retry loops, the polling intervals and the fallback branches that reading the code does not recover. Keep the structure
and every branch; reword the labels for the captain; cite the document. A sequence invented from imports is not a worse
version of the documented one; it is wrong.

**When no document exists, draw it anyway.** Read the entry points, what calls what, where state changes, what is
written, and draw what you understood. Studio marks it inferred. An imperfect drawing is far better than none.

**The drawing goes through diagram-design, as baton's does** (workflows/skills/diagram-design: semantic pattern first,
then the type's reference, its connector rules, the 4px grid, the budgets, the pre-output checks). Two ways in the room:
draw it yourself with `figure_svg` (one SVG by those rules, colours only as `var(--fig-…)`, `data-node`, `data-edge` and
the three languages on every text; Studio drops what is off its allowlist and refuses a figure whose labels overlap or sit
on a line, or whose connector runs through a box that is not one of its ends: redraw it), or give board_draw the structure
(an `arch`, `states`, `sequence`, `item`, `decision` or `calls` item) and Studio lays it out by the same rules. Either way
the page owns light and dark and the captain's language; never send hex colours, fonts or other markup.

## What each drawing shows

- **arch** (what talks to what): the subject's components solid, its context (`external`, a third party) apart; the shape
  follows the kind (`store` for a datastore, `queue`, `external`, `actor` for a person or a client, `service`). Mark the
  change on the node itself (`mark: new | changed | removed`). Leave plumbing out: shared helpers, error types, generated
  code, the packages everything imports. Every connection you can show in the code or a document cites it.
- **decision**: the question the change had to answer, the option it took, and why in one line. A rejected option only
  with the commit, the pull request or the review note that shows it, cited.
- **item** (one per changed item): before and after on the same component, the mechanism named with its proper noun
  (`ENV == "development"`, `esc() at all 47 builders`, `checked at dial`), not a euphemism. Labels short enough for the
  one layout: the name at most 33 Latin or 16 CJK characters, each side at most 40 Latin or 20 CJK.
- **states** (the lifecycle, baton's statemap): one figure for each entity the change moves (an order, its
  authorization), each naming its `entity` (the column). Every state and every transition the code has; each transition
  cites the code that makes it and carries its database transaction in `tx`: the tables written (INSERT/UPDATE/DELETE,
  each field was → now), the guard (the CAS predicate, the unique key, the row condition), and what is written outside it
  (a cache, the outbound call, an event), which the page sets apart. The captain picks a state or a transition to see it.
- **calls** (every call): for each API call the change adds or changes, its request, its response (and the errors a
  client sees), and the transaction it runs (`tx`), cited.
- **sequence** (one request): one event a step; calls, returns and async calls; the loops, alternatives (`alt` / `else`)
  and options (`opt`) the code really has, as frames. Keep proper nouns intact (`POST /authorize`, EIP-712).

## Labels

Identity and wording are separate: an id is the name from the source (a state, a component), the label is the captain's
wording. Keep the mechanism's proper nouns; never alias participants to single letters. Write each label to fit: a label
over the drawing's limit is refused and you shorten it.

## Variants and evidence

When a feature has more than one mode, show them together (one drawing, the steps that differ side by side), not one
drawing per mode. Separate "built" from "proven": a path exercised for real is not the same as code that exists; never
infer a tick from shared code.
