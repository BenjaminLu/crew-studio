# Diagrams

## Who draws

**Look for a design document first, every time.** `design*.md`, `docs/**`,
`*spec*.md`, `openspec/**`, an architecture note in a README — find them and
read them. When one carries a diagram, that is the structure to use: its
author already did the modelling, and it holds the retry loops, the polling
intervals and the fallback branches that no amount of reading the code
recovers. Keep the structure and every branch exactly; reword the labels for
the audience. A sequence diagram invented from imports is not a worse version
of the documented one; it is wrong.

**When no document exists, draw it anyway.** Read the code — the entry points,
what calls what, where state changes, what the database writes are — and draw
what you understood, labelled as inferred so the reader knows its standing. A
diagram you derived is worth far more than a page of prose; the failure to
avoid is not an imperfect diagram, it is no diagram. Say what it is based on
and where you were unsure.

**Every route draws.** Done work for an engineer, done work for someone who
does not read code, a document about work not yet done — all produce
diagrams; what differs is the audience and which kinds earn their place,
never whether to draw. A packet of prose is the thing
this format exists to replace.

**The drawing itself goes through the `diagram-design` skill.** Invoke it — do
not hand-write SVG and do not fall back to mermaid. It carries forty diagram
types, semantic-pattern routing, a 4px grid, connector rules and a pre-output
quality gate; reimplementing any of that inside baton would be worse and would
drift. Tell it the type, the subject, and the packet's tokens.

What you hand it, every time:

- **the structure** — from the design doc, or from what you read in the code.
  It draws what you specify; it does not invent the model
- **the packet's palette as brand tokens**, so the diagram inherits the page
  instead of carrying its own colours (see *What to show*)
- **the embedding contract below** — baton needs three things a standalone
  diagram does not

Diagram correctness is checked **by eye, in a real browser** (pipeline §6).
`verify.py` does not read diagrams: their structure came from a source you
read, and the failures that remain — a clipped label, an illegible layout, a
language leak — are the ones only eyes catch.

## Draw the variants, and draw what is unproven

**When a feature has more than one mode, show them together.** One diagram per
mode buries the only question a reader has — how do these differ, and where do
they become the same thing? Put them in stacked panels: the steps that differ
side by side, and the point where the paths merge marked, so the reader sees
that the difference is three steps and not a second implementation.

**Separate "built" from "proven".** A checklist that says a feature works
usually means one path was verified end to end and the others were reasoned
about. That distinction is the most decision-relevant thing on the page and it
is invisible in a diff: code exists for both, evidence exists for one.

Use **three states, not two** — verified against the real thing, code only
(written, unit-tested against a mock, never exercised for real), and absent.
Two states forces a judgement call on every middling row and the tick always
wins. Give it a matrix — capability down the side, variant across the top —
state the conclusion underneath in a sentence, and gloss the middle mark so
nobody reads it as a weaker tick.

**Never infer a tick from shared code.** "Both paths converge on the same
implementation, so both work" is reasoning, not evidence — and it is the exact
mistake this matrix exists to catch. A step is verified when something was run
against the real system: a live test, a real transaction, a sign-off you can
point at. Mock unit tests are code-only, however green. Read the evidence:
a pull request checklist, a live test invocation, a QA note. "Implemented on
our side and never run against the partner" is a true and useful sentence;
"done" is not.

## When the document compares options

A document that weighs several options is the strongest material this format
gets — and the easiest to under-serve, because each option arrives as a slab
of prose and the differences drown. Spend the diagram budget here. Three
layers, in this order:

**1. The decision matrix — on the questions that separate, not the attributes
that exist.** Find the two to four questions whose answers actually differ
across options (does the payer sign each time? can the confirmation go away?)
and refuse the rest — a matrix of every attribute is a table wearing a
diagram's clothes. Two rules from a shipped mistake:

- **Each column answers its own question with its own words.** One yes/no
  vocabulary shared across columns made a "does the friction go away?" column
  print the words for "is the cost paid?" — literally inverted. Define the
  mark set per column.
- **Colour follows the goal, not the literal answer.** Green marks movement
  toward what the document wants, whichever word sits in the cell; "yes" is
  not a colour.

**2. One mechanism drawing per option — no exceptions.** A matrix says how
options differ; only a mechanism drawing says what each option *is*, and a
reader cannot weigh what they cannot picture. Keep the drawings structurally
parallel (same flow direction, same place for the actor, same place for the
risk) so flipping between them reads as a comparison rather than seven
unrelated pictures. An option's diagram may be another section's drawing
reused — the shared baseline is one option's picture, the recommended flow's
sequence is another's.

**3. What it buys / what it costs, as paired panels.** Every option's pros
and cons drawn the same way, in the same order: one panel for what the option
buys (ok-toned), one for what it costs (amber or seal), each holding the two
or three claims that survive compression — not the document's full bullet
lists. The pairing is the point: a benefit shown without its price reads as
advocacy, and the reader is here to decide, not to be sold. Close each option
with the one line that would change the decision, stated plainly.

When the document also takes positions — build this, pilot that, park the
other — draw the verdict map as lanes (now / next / gated / parked) and keep
it separate from the matrix: one drawing for what the options *are*, one for
what the author *decided*. Conflating them hides the argument the reader came
to check.

## The embedding contract

`diagram-design` outputs a standalone HTML file. A packet needs the `<svg>`
from inside it, meeting three conditions. State them in the request; check
them in the output.

**1. Colours as tokens, not hex.** The page owns light and dark. Ask for fills
and strokes as `var(--accent)`, `var(--seal)`, `var(--ok)`, `var(--amber)`,
`var(--muted)`, `var(--rule)`, `var(--card)`, `var(--fg)` — the packet's
variables. A diagram with baked-in hex looks wrong the moment the reader
switches theme, and switching is one tap away.

**2. Node identity on the shape.** Every shape that stands for something the
reader might select carries `data-node="<latin-id>"`, the id from the source.
Without it the interactive statemap has nothing to bind to, and no diagram can
be linked to the transaction behind it.

**3. Three languages on every text node.** `data-en`, `data-hant`, `data-hans`
on each `<text>`, with the visible content one of them. One SVG, three
languages — switching swaps `textContent`, so the layout cannot drift. A text
node missing one attribute leaks English onto the Chinese page.

Also: **no external fonts.** The generated file links Google Fonts; a packet
must render offline and inside a sandboxed iframe. Strip the link and let the
page's own font stack apply.

Extract the `<svg>` block into the figure section's `svg` field. Keep the
`role="img"`, `<title>` and `<desc>` it generates — that is its accessibility
work, and it costs nothing to carry.

## The kinds worth reaching for

`diagram-design` covers forty types. These are the ones that earn their place
in a packet — ask for the type by name:

- **architecture** — from the design doc's, or from the imports you read,
  labelled as inferred
- **state machine** — or the interactive **statemap** below when the states
  have database writes behind them
- **sequence** — keep the activation bars, the async and return arrows, the
  loops and alt branches the document drew
- **transactions** — the DB lifecycle, one transaction per state edge (below)
- **flowchart** — for an attack path (entry → breach with the fix cutting the
  chain) or an activity flow with decisions, fork/join and swimlanes
- **before / after** — two panels, nodes marked added / removed / changed, for
  a refactor or a bugfix

Shape carries meaning: a cylinder for a datastore, a doubled box for an
external system, a diamond for a decision, a stadium for a start or terminal
state, a parallelogram for a queue. Ask for them; do not settle for uniform
rounded rectangles.

## How the page renders

The extracted `<svg>` is inlined in the packet — no runtime library, no
network. It inherits the page's light and dark themes through the tokens
(contract 1) and re-labels on a language switch through the three text
attributes (contract 3). Both are page behaviour; the diagram itself is
static markup.

Legibility is part of correctness: no overlapping text, no truncation, no
label clipped by its box. `diagram-design`'s own pre-output gate catches most
of this; the browser check (pipeline §6) is the gate that counts.

## Labels

One drawing, three languages: every `<text>` carries `data-en`, `data-hant`
and `data-hans`, and switching swaps `textContent` — so the geometry never
moves and only the words change. Size the boxes for whichever language runs
longest; size to one and the others overflow or sit half empty.

A text node missing one attribute leaks English onto the Chinese page, and one
leaked label reads as carelessness across the whole packet — this shipped once
and was the first thing the reader noticed. Every label, every language, no
exceptions but marked code terms.

**In a sequence diagram, one event owns one horizontal band.** A self-call
with a guard condition and a result is three events, not one annotated arrow:
give the call, the guard, and the outcome each their own row with clear
vertical separation, every label masked. Three annotations packed around one
loop shipped once — the guard ran under the loop's arc and the result row
collided with the next message's label. Budget roughly 48px of height per
event and the collisions cannot happen.

**The canvas grows from the content; nothing is placed from the bottom up.**
The legend strip's y-position is conventionally computed from the figure
height — which silently breaks the moment the content grows and the height
does not: a matrix gained a takeaway row and the legend printed straight
across it. Lay out top-down, note where the last content row ends, and only
then set the height as that plus the legend band and its gap. Any element
positioned as "height minus something" is a collision waiting for the next
edit.

**A label between two nodes needs room that was designed for it.** Size the
gap to the *longest* language's label plus a masked clearance — never to the
shortest, and never to whatever the layout happened to leave. A state machine
shipped with 24px gaps and unmasked edge labels: the two-character CJK label
fitted, and its English sibling `confirmed` was 59px, so it ran straight
across both neighbouring boxes. The
rule that avoids it: measure the longest label, give the mask 6–8px of slack
around it, and give the gap 4px of clearance beyond the mask at each end — so
the mask never paints over a node, and the label never touches its connector.

**CJK never below 12px**, and prefer 14px for node names. Geist and the serif
carry no Han; the fallback CJK face renders visually smaller at the same
nominal size, so 11px that looked fine in a latin mock is unreadable in
Chinese.

Neither of these was visible while the page rendered diagrams in a narrow
column — the whole figure was small enough that a cramped one looked merely
dense. The content column is the full page width now, so a diagram is shown at
the size it was drawn at: under-sized geometry is exposed rather than hidden,
and there is no longer any reason to draw cramped.

## What to show

Subject components solid, context dashed and muted — drawing them alike
buries the part the reader came for. Mark change on the node itself (`new`,
`changed`, `removed`), not in a legend the reader has to consult. Leave
plumbing out — shared helpers, error types, generated code, the packages
everything imports and nothing depends on. That is a judgment you make by
reading the tree, not a fan-in/fan-out computation; a diagram showing that
the codebase has utility packages has spent the reader's attention on
nothing.

**Color comes from the packet's palette** — the template carries a light and a
dark theme; diagrams inherit both, never a grayscale of their own. Assign
color by meaning and keep the assignment
constant across every diagram in the packet: one hue for the subject, muted
neutrals for context, the change marks (`new`/`changed`/`removed`) each
theirs, the outside-the-transaction writes visibly apart from the envelope.
A monochrome diagram makes the reader do with position what color could have
told them at a glance; a decorative rainbow is worse, because color that
means nothing teaches the reader to ignore the color that does.

## Per-change before / after: what it did, what it does now

For a fix series — a security hardening, a bug-sweep branch, any PR that
changes behaviour — a list that *names* the changes is not enough: a reader
asked for exactly this once, having been given the list. **Every change gets
its own `vuln` card, and every card gets its own before/after diagram.** The
card answers four questions the reader actually has: what the system **did**,
what it **does now**, *where* the change sits (the `ref` line: sub-PR +
`file:line`), and *why* the new behaviour follows (the mechanism, named).

**The rule this section exists for: AFTER states the new behaviour, never the
absence of the old one.** "No longer diluted", "不再被稀釋", "✗ blocked", a
struck-through copy of the BEFORE box — every one of these was shipped, and
every one told the reader nothing the card title had not already said. The
reader wants the new value, the new error, the new state, the new call: "0.89%
→ 2.68%: unobserved validator gets weight 0", "2nd REQUEST at N+1 → 4017, zero
writes", "returns `HTTP 429 (offset=500)`; run stops, pages k+1…N wait 24h". If
the change has a cost or a residue, AFTER says that too — an AFTER that hides
a regression is worse than one that is lazy.

The card's `ref` line is **clickable**: the sub-PR number links to its PR
page and the fix's `file:line` links to the GitHub blob at a pinned commit
SHA — the identifier itself is the link, nothing visual is added (mechanics
and the line-relocation rule: `spec.md` § Code links).

The diagram is one SVG, two rows, same geometry for every change — **draw it
with `scripts/figures.py` `before_after()`**, which refuses a lazy AFTER:

- **BEFORE row:** trigger → component as it was (sublabel: the old mechanism,
  `return nil, 0, err  // err==nil`) → **before outcome**, what observably
  happened. `--seal` if it cannot be undone, else `--amber`.
- **AFTER row:** the same trigger → component as it is now (`--accent`; the
  sublabel is the new mechanism itself — `fmt.Errorf("…HTTP %d…")`,
  `window ∩ [activation, exit)`, the proper noun, not a euphemism) → **after
  outcome**, a live `--ok` box stating what observably happens now. Never
  dashed, never dimmed, never ✗.

The card's `before` / `after` fields carry the same two outcomes as sentences
(spec.md § vuln); `problem` / `fix` keep the why and the mechanism. The "why
it works" sentence in `fix` must name the mechanism and the reason it closes
the class (fail-closed vs fail-open, type enforcement, checked-at-dial), not
restate that it is fixed.

**The gate.** `verify.py` fails the page when a change card has no `before` /
`after`, when AFTER equals BEFORE or is BEFORE plus a negation, when AFTER
names nothing concrete (no `code` term, number or quoted value), or when the
figure lacks `data-node="before-outcome"` / `"after-outcome"` boxes or draws
the AFTER outcome struck through. Fix it by writing what happens now — never
by rewording the negation until the checker stops noticing.

**Generate these, do not free-draw them.** One layout function emits every
card with identical spacing, and `snapshot.py`'s per-language overflow check
then validates every label in every language mechanically. Node widths are
fixed, so write labels to fit: names ≤ 16 CJK glyphs / ≤ 30 latin characters
at 13px, sublabels latin-only mono ≤ 30 characters. Severity maps to the card
chip: critical → `p0`, major → `p1`, minor → `p2`.

## The database lifecycle: transitions as transactions

When the change is a state machine over database rows, the lifecycle page is
the state machine with **each edge opened into the one database transaction
that implements it** — never a timeline of schema files. Per transition:

- the tables written, INSERT or UPDATE, each field **was → now**
- the guard: the CAS predicate, the unique key, the row condition
- and, **visually set apart** — dashed where the transaction envelope is
  solid — the writes that happen *outside* it: caches, evidence rows, the
  outbound call itself

The in/out boundary is the content. A reader who cannot see which writes
commit together assumes they all do, and that assumption is exactly what the
claim-before-dispatch designs of this world exist to break.

Cover **every transition the code has**, not the memorable ones. A typical
payment lifecycle has around seven — create, transition, open an attempt,
claim it for dispatch, close it, release the claim, cancel — and the
easy-to-skip edges (the claim, the release, the cancel) are precisely where
the double-charge protection lives. A subset reads as the whole and misleads.

Never ship a standalone "schema changes" timeline page. A change whose schema
story is one trivial migration gets it folded into the transaction it serves,
or omitted — a page holding one lonely box was shipped once, and it told the
reader only that the author had a template to fill.

## The interactive state map — states linked to their DB writes

When the change is a state machine over database rows, the strongest single
view is the two joined: a clickable state machine where selecting a state
reveals the exact transaction that produces it, and lights up which rollout
stage (add / fill in / switch over / remove) it belongs to. A reader stops
context-switching between "what states exist" and "what hits the database" —
the two are one surface.

This is the `statemap` section kind. Ask `diagram-design` for a state machine
and require contract 2 — every state shape carrying `data-node` with the
state's id:

```html
<rect data-node="AWAITING_COURIER" .../>
<text data-en="Waiting for pickup" data-hant="等快遞取件"
      data-hans="等快递取件">Waiting for pickup</text>
```

The page binds the clicks itself: it delegates from the figure, reads
`data-node` off the shape, and calls its own handler. The diagram stays static
markup with no script of its own — which is why the interactivity survives
being inlined in a sandboxed iframe.

The section also carries `detail` (state id → the transaction, same shape as a
txn section) and `stages` (state id → expand | backfill | cutover | contract).
The page renders the state machine, and on click shows the transaction below
and highlights the stage strip. It seeds a default selection so the panel is
never empty.

Reach for it whenever states and their persistence both matter — which for an
order/payment/job lifecycle is almost always. A static state machine plus a
separate transactions page is the fallback when there is no clean state-to-
transaction mapping.

## The database rollout

The rollout page exists only when the change carries several migrations whose
ordering matters. One migration is not a rollout; fold it (above).

Read the migration files and place each in the expand → backfill → cutover →
contract arc yourself — whether a step is reversible, destructive, or locks a
table is a judgment from the SQL, and you make it better than a regex. Order
by that arc, never by timestamp: the reader needs to see
that adding is safe and reversible, that removing is neither, and that the
gap between them is where a rollout can be paused. A list sorted by filename
shows none of that. Mark on the step itself, not in a legend:

- **no way back** — re-adding a dropped column returns the column, never the
  rows
- **locks table** — safe on an empty table, an outage on a large one
- **withdrawn** — added and removed inside this change, which the working
  tree cannot show and the reader needs told

There is **no "we are here" marker.** Whether a migration has run against a
live database is not in the repository, and a marker placed by inference
answers the reader's most urgent question with a guess they cannot
distinguish from a fact.

## Identity and wording are separate

`data-node` carries the name from the source — a component, a state, a
participant. The `<text>` carries the reader's wording, in all three
languages. Never the same string:

```html
<rect data-node="AWAITING_COURIER" .../>
<text data-en="Waiting for pickup" data-hant="等快遞取件"
      data-hans="等快递取件">Waiting for pickup</text>
```

Without the split, the format's two rules contradict each other: rename the id
for the reader and the drawing stops matching the design doc it came from, and
nothing can be linked to it; put the source name in the visible text and the
page fails the register check (pipeline §4). The id lives only in the
attribute — `AWAITING_COURIER` sitting visible in a box on a PM page is a
leak, not a label.

The same goes for labels taken from a spec. A design document is written by
engineers: its diagrams name functions and columns (`createOrder`,
`transaction_id`) and alias participants to single letters, so a straight
import produces `U -> B` — which looks like information and carries none.
Take the structure from the document; write the words yourself — but keep the
mechanism's proper nouns. A sequence step is "signs an EIP-2612 permit", not
"confirm payment"; the proper noun is what the reader is there for. Simplify
the wording around a step, keep EIP-2612, EIP-712, SIWE, `POST /authorize` and the
like intact, and add them to the glossary so the register check permits them.

## What the script checks, and what eyes must

`verify.py` never reads a diagram. Mermaid sources are code: their labels
come from the trusted design doc, and scanning them with the prose-register
check would reject every correct diagram ever drawn — a checker that cries
wolf gets switched off. The script checks what a script is good at —
absences: the refusal declaration, a digest-thin context, an identifier bare
in prose — and the diagrams have exactly one gate: the rendered page, open in
a real browser, checked by eye (pipeline §6). Skipping that check shipped a
broken packet once; it is not optional.
