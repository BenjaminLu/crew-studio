# Drawings (baton's diagrams guidance, adapted to the review room)

## Who draws

**Look for a design document first.** `design*.md`, `docs/**`, `*spec*.md`, an architecture note in a README: read them
with fs_search and fs_read. When one carries a diagram, that is the structure to use; its author already modelled the
retry loops, the polling intervals and the fallback branches that reading the code does not recover. Keep the structure
and every branch; reword the labels for the captain; cite the document. A sequence invented from imports is not a worse
version of the documented one; it is wrong.

**When no document exists, draw it anyway.** Read the entry points, what calls what, where state changes, what is
written, and draw what you understood. Studio marks it inferred. An imperfect drawing is far better than none.

**Studio draws, you supply the data.** board_draw takes the structure (nodes and edges, states and transitions, actors
and steps, before and after) and Studio lays it out, in the room's light and dark themes and in the captain's language.
You never send coordinates, colours or markup.

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
- **states** (the lifecycle): every state and every transition the code has; each transition cites the code that makes it
  and says in `detail` what it writes (the table and the fields, the guard). The captain opens each transition to its code.
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
