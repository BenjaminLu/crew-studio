---
name: baton
description: Use when the user says "baton", "review this", "review where we are", "pack this up", "I'm stopping here", "hand this to future me", "save context before I switch", "write this up for my PM", "report this upward", "explain this to the boss", 向上報告, 總結這幾個 commit, or wants the state of any work handed on — a feature branch, a debugging session, an incident, an investigation, a refactor, a migration, a security fix, a local experiment with no branch. Also use when the user pastes or points at a PRD, spec, RFC, technical proposal, decision doc, 需求文档, 设计文档 or 决策文件 and wants it visualised, explained, or turned into something a team can align on.
---

# baton

Turn a piece of work — or a document about work not yet done — into one
self-contained HTML page: diagrams the reader walks in minutes, with the
**complete context** embedded so the reader's own coding agent — Claude Code,
Codex, Cursor, anything — picks up where you are and keeps answering.

`references/pipeline.md` is the whole build. This file is the two decisions
that shape it, and the rules that differ by decision.

## First decide two things — from the evidence, never by asking

**1. What is the input?**

- **Done work.** This session, a branch, commits, a bugfix, an investigation,
  an incident; "pack this up", "where are we", "I'm stopping here",
  總結這幾個 commit. A repo is not required — a debugging afternoon with no
  branch packs as well as a merged feature; never refuse for want of a repo.
- **A document about work not yet done.** A PRD, spec, RFC, design proposal,
  decision doc, 需求文档/设计文档/決策文件 — pasted inline, attached, or named
  by path or URL. Tell-tales: user stories, acceptance criteria, options under
  consideration, "we should/will build", no commits or session work
  corresponding to it.

**2. Who reads the page?**

- **An engineer** — future you, or a colleague inheriting the branch. One who
  has forgotten, not one who was never told. Register `engineer`:
  identifiers, paths and code stay.
- **Someone who does not read code** — "for my PM", "report upward",
  "explain to the boss", 向上報告, an executive, director or non-technical
  audience named or implied. Not stupid, not lazy — no context, very little
  time, and one question: **what can now go wrong for our users?** Change is
  your unit; risk is theirs. Register `eli5`.

Tie-breakers:

- Done work with no audience stated → engineer. The `eli5` register requires
  an explicitly non-technical reader.
- A document whose content the repo or session shows is **already
  implemented** is not a proposal any more: treat it as done work and say so
  on the page — proposal framing would mislead.
- Mixed input — a spec plus a session that partially implemented it — routes
  by the deliverable asked for: "visualise / align on the plan" → document;
  "where did we get to" → done work.
- For a document, the register follows whoever the document is for: a PRD
  read by a PM takes `eli5`, an RFC among engineers takes `engineer`. Keep
  the mechanism's proper nouns either way — a decision about EIP-712 is not
  a decision about "signing".

Announce the choice in one short line (e.g. "baton — 已完成的 commit 總結，
讀者是工程師"), then build. Ask only when the input is a genuine stub — a
title and a few bullets — and then about the missing content, never about
which route.

## Rules that hold on every route

**Always diagrams.** If the source carries diagrams, reuse their structure;
if it does not, draw from the code or the document and say the drawing is
your reading of it. The one thing never to ship is no diagram at all — a
page of prose is the thing this format replaces.

**Components, not text.** Every section is a component — `chain`,
`boundary`, `compare`, `matrix`, `steps`, `stats`, or an SVG `figure` —
with at most a two-sentence lead (`references/components.md`). Text lists
and three-box before/after cards are retired: they read as plain text, which
is what this format replaces. `verify.py` fails a section that is mostly
sentences.

**Every change is a chain.** When the ask — or the document — enumerates
items (each commit, each fix, each claim, each scenario), each gets a `chain`
card: the **same real component chain** drawn twice, BEFORE with the node
where it breaks marked and AFTER with the node that changed marked, a callout
on that node giving the mechanism (with the identifier), the observable
outcome at the end of each lane, and the proof underneath
(`components.md` § chain). Name real components — `SyncDevice`,
`devices_wallets`, `nginx filter.lua` — never "backend".

**AFTER says what happens now — never that BEFORE stopped.** The AFTER
outcome is the new value, error, state or call. "No longer diluted", "不再被稀釋"
or "✗ blocked" is the card title restated; `verify.py` rejects it.

**Review proof, not code.** Every claim carries its evidence: tests, CI runs,
end-to-end checks, logs, source reads — each explicitly marked `verified`,
`code-only` or `absent` (no default; a chip without one fails `verify.py`). A pull request packet opens with a proof matrix (claims ×
evidence type) so a reviewer sees in one glance what is shown and what is only
asserted (`## Pull requests: review proof` below).

**Do not guess.** The reader cannot tell your inferences from your facts, so
do not mix them. Deployment state — whether a migration ran, whether users
see anything today — is not in the repository. When there is no PR, or `gh`
cannot reach the forge, say nothing about tests or reviews. "Not recorded
here — ask" is a complete answer; a guess spends trust you cannot get back.

**The context is complete.** Three layers (pipeline §2): the record, your
own compaction, and how to pull more. Build it before the page, which is only
a view of it. A context that could be regenerated from `git log` has failed.

**End with the boundary map.** The last section is a `boundary` map of every
place the work crosses between systems — client ↔ server contracts first,
then services, queues, SDKs, shared data, external parties — checked through
six lenses: identity, truth, effect, dependency, coexist (old/new versions),
edges (`references/boundary-review.md`). Each real finding is a numbered pin
on the node or link where it lives and has its own `chain` card; links with
no finding render green. When nothing is wrong, the map says what was checked
and that it is fine — never a padded finding. For a pull request, findings are
also written as paste-ready review comments in the context; posting them is
outward-facing and waits for the user to ask.

## Pull requests: review proof

When the input is a pull request, the engineer's job is to judge **whether
the change is proven**, not to re-read every line. The packet is built for
that judgement, in this order:

1. **Proof matrix** (`matrix`) — one row per claim the PR makes (from its
   title, body, commits and diff), columns for the evidence types that apply
   (source read, unit/request test, CI, end-to-end or live check). Marks:
   ✓ verified, ✕ missing, — not applicable. A `stats` lead counts claims with
   proof, e.g. `3/5 claims tested`.
2. **One `chain` per claim** — BEFORE/AFTER on the real components, the
   mechanism on the marked node, and proof chips that link to the exact test
   (`file:line`), CI run, or log. The strongest proof is a test that fails on
   the base and passes on the head; say when you ran that, and only then mark
   it verified.
3. **What the PR does not prove** — every ✕ in the matrix is a concrete
   to-do (the test to add, the drill to run), not a vague concern.
4. **Boundary map** — last, as on every route.

Read CI with `gh pr checks <N>` / `statusCheckRollup`; map the PR's own test
changes to the claims they cover. A claim whose only evidence is "the code
looks right" is `code-only`, never `verified`.

## If the input is done work: what only the session knows

The compaction's *paths taken and abandoned*. A diff shows the approach that
survived; only the session knows the three that were tried and reverted and
why they died — the ruled-out auth gateway, the rejected storage approach,
the state removed on product grounds and the unverified assumption that
removal rests on. That is what a closing session throws away, and recovering
it is why this skill exists. Write every workstream — you lived it.

For a past session you were not part of, read the transcript JSONL under
`~/.claude/projects/<slug>/` selectively — the user turns and the failed
commands, filtered with a short inline command, not the whole stream; the
deliverable is still all three layers.

## If the input is a document: a proposal is not behaviour

The reader cannot tell your diagram of an intended flow from a diagram of a
shipped one, and if they confuse the two they will plan against something
that does not exist. So:

- The subtitle, the footer and the context's first line all say **proposal**
- `layer` is `proposal`, never `L0`/`L1`
- Where implementation *does* exist, say which parts — and say what is
  inferred where it does not

**Read the document and decide what it is.** The kind decides the diagrams:

| what you find | the shape it wants |
|---|---|
| user stories, acceptance criteria, flows | the **user journey** as a flowchart; the fiddliest acceptance rule as a **decision tree** |
| a decision with rejected alternatives | **rejected vs recommended**, side by side — the alternatives are the argument |
| several competing options weighed against each other | the full **comparison treatment** (`diagrams.md`): a decision matrix on the separating questions, one mechanism drawing per option, and paired what-it-buys / what-it-costs panels |
| a risk register | the top risks as **attack paths**, entry → impact, with the control that cuts each |
| scope and non-goals | **in / out** panels; a non-goal is a decision, not an omission |
| API or data contracts | a **sequence** for the exchange, a **state machine** if it has a lifecycle |
| open questions | a list at the end, ranked by what blocks the most work |

Most documents want three or four of these, not all. A section whose source
paragraph is thin should not become a diagram.

**Then check it against the code.** Search for the feature's nouns, look for
the routes and modules it names. Two outcomes, both worth saying plainly:

- **Nothing exists yet.** Every diagram is the proposal. Say so once, clearly.
- **Some of it exists.** Mark which parts have code behind them and which do
  not, and flag anywhere the document contradicts what the code already does —
  that contradiction is the most valuable thing on the page, and only this
  route can find it.

**The context carries the document whole.** Do not summarise it into the
packet — the diagrams are the summary; the context is the source. Then your
own reading of it (what it decides, what it leaves open, what it contradicts),
then how to pull more: the specs it cites, the code that would implement it.

## Order of work

1. **Ground truth** — pipeline §1. Done work: the session first, then git,
   the pull request, the design docs and the migrations *if they exist* —
   each an enhancement, none a prerequisite. Document: read it, classify it
   by the table above, then check it against the code.
2. **Context** — pipeline §2, all three layers, before the page.
3. **Wording** — `eli5` register only: invoke the `eli5` skill, audience
   Product Manager (Director for an executive), and hand it your compaction
   and the extracted facts. `engineer` register: skip `eli5` unless the
   wording needs sharpening.
4. **Page** — `render.py` fills baton's template (scroll / one-pager); spec
   shape in `references/spec.md`. Lean. Typical sections, each dropped if its
   source is empty:
   - *What this is* — one paragraph a person could repeat
   - *What talks to what* — the design doc's architecture diagram, adapted;
     drawn from the code and labelled as inferred when there is none
   - *Proof matrix* — PR route: claims × evidence (rule above)
   - *The change itself* — one `chain` per change or claim (rule above)
   - *The order's life* — the state machine, each transition openable to its
     one database transaction — full set, never a subset (`diagrams.md`)
   - *One payment, in order* — the sequence diagram, real loops and
     fallbacks kept, labels reworded for the reader
   - *Roads not taken* and *next steps* — the abandoned paths, from the
     session
   - *What to watch* — risks only, each traceable; an empty list is a
     finding, an invented one is a lie
   - Document route: the shapes from the table, with in / out panels and the
     open questions
   - *Boundary map* — always last, every route
     (`references/boundary-review.md`); "no issue" is a complete answer
5. **Verify** — `verify.py --register <engineer|eli5>`; fix by finding a real
   word, never by deleting the sentence. Then the real-browser check, pipeline
   §6 — non-skippable; a packet once shipped on script checks alone was
   completely broken.
6. **Publish** — `Artifact` if a URL is wanted; otherwise the file beside the
   work is the deliverable. **PDF only on request** (or when a file handout is
   clearly needed): `python3 "$BATON/scripts/export_pdf.py" baton-<slug>.html
   --lang hant` — same page, same colours; never a second template, never PPT.

## When not to run

Say so plainly instead of shipping a hollow packet:

- No transcript and no session context — there is nothing to compact, and
  `git log` in costume is worse than saying so.
- The session did no substantive work (nothing to compact but metadata), or
  the change has no reader-facing consequence at all.
- The document is a stub — a title and a few bullets. A page of diagrams
  drawn from three sentences invents structure the author never committed to.
