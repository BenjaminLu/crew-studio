# baton, for the review room's lesson

Adapted from baton (see NOTICE.md in this folder). baton turns a piece of work into one page of diagrams a reader walks
in minutes. In the review room the page is the lesson the captain asked for ("teach me this change"): Studio lays it out
as a report, you supply its chapters and the data of every drawing, and Studio draws them. You never hand-draw a picture
and never write markup.

## Who reads it

The captain: an engineer about to merge a change they did not write, one who has no context and little time. Identifiers,
paths and code names stay; the wording around them is plain. The captain's one question is what this change does and what
can now go wrong.

## Rules that hold on every lesson

**Always drawings.** If the repository carries a design document with a diagram, keep its structure (every branch, every
retry loop, every fallback) and reword the labels; cite the document. If it does not, draw from the code you read and let
it stand as inferred. The one thing never to ship is a lesson without drawings: a page of prose is what this replaces.

**Per-item drawings.** When the change has several items (commit groups, subsystems, fixes), every item gets its own
`item` drawing: name, before, after and the mechanism that changed it, cited to its diff. Studio draws every item from one
layout, so write labels that fit it (the tool says how long). A list that only names the items reads as if nothing was
changed.

**Do not guess.** The captain cannot tell your inferences from your facts, so keep them apart: a point without a verified
citation shows as an inference. Deployment is not in the repository: never say whether a migration ran or whether users
see anything today. With no record of reviews, say nothing about reviews. "Not recorded here" is a complete answer.

**The full set.** A state machine shows every state and every transition the code has, not the memorable ones: the
easy-to-skip edges (a claim, a release, a cancel) are where the protection lives, and a subset reads as the whole.

**Roads not taken only from the record.** An alternative the change did not take is shown only when a commit, the pull
request or a review thread shows it, cited. You were not in the session that wrote it: never reconstruct one.

**What to watch is risks only, each traceable.** An empty list is a finding (say what you checked, cited); an invented
risk is a lie.

## The chapters

Shown in this order, made in any; Studio refuses a lesson that skips one it owes (see the review room tutor's "Lessons,
chapter by chapter"):

- *What this is*: a few points the captain could repeat.
- *What talks to what*: the architecture, one `arch` drawing; inferred unless a design document or the record shows it.
  Left out only with chapter_skip and a cited reason (nothing talks: a docs or config-only change).
- *The decisions*: one `decision` drawing a decision the change makes, when it makes some.
- *The change itself*: one `item` drawing a changed item, at least one.
- *Its life, state by state*: one statemap for each entity the change moves (the full set of states and transitions,
  each transition citing its code and carrying the database transaction it runs). When the diff writes a state or status
  column it is owed and cannot be left out; otherwise left out only with chapter_skip and a cited reason.
- *One request, in order*: one `sequence` drawing, real loops, alternatives and options kept. Left out only with
  chapter_skip and a cited reason (no call chain across services or I/O).
- *Every call*: for each API call, its request, its response, the transaction it runs (a `calls` item).
- *What reviewers raised*, *Roads not taken*, *What to watch*, *Open questions*: points, each cited; shown only when there
  is something.

One drawing a chapter, except the change (one per item), the decisions (one per decision), the lifecycles (one per
  entity) and the calls. Every drawing follows workflows/skills/diagram-design. `diagrams.md` says what each
drawing needs; `spec.md` is the exact shape of each.
