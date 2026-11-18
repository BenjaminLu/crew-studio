# Building a packet

baton is an orchestration skill. It stacks capabilities that already exist and
adds the one thing none of them do: compressing a piece of work into something
another person — and their coding agent — can pick up.

| what | comes from | not from |
|---|---|---|
| the record (§2a) | the session itself, plus git, the pull request, and the design docs **when they exist** | assuming a repo, or counting commits backwards |
| the compaction (§2b) | **your own context window** — you did the work | transcripts re-read by machine, `git log` |
| audience wording | the **`eli5` skill** | register rules restated here |
| page design | baton's own template (`templates/packet.html`) | ad-hoc per packet |
| diagrams | **the repo's own design docs** for the structure, which you find and read; the **`diagram-design` skill** for the drawing | hand-written SVG, mermaid in the packet, or inventing structure |
| schema story | the migration files, which you read, + the design doc's data tables | guessing at rollout state |
| session discovery | you, listing `~/.claude/projects/<slug>/` transcripts | asking the user for IDs |
| checks | `verify.py` for mechanical absences; **your eyes in a real browser** for diagrams | trust |
| the URL | the **Artifact** tool | hosting anything |

Two outputs, two guarantees, never conflated: **the page** is for a person, in
minutes — everything on it traces to a source; `verify.py` checks the prose
register and the context's presence, a real browser checks the diagrams (§6).
**The embedded context** is for their agent, indefinitely — complete, in three
layers (§2), never a digest.

Only three scripts exist in the default build, and all are mechanical on
purpose: `render.py`
(assembly), `verify.py` (register/absence scan), `snapshot.py` (headless
screenshots + the mechanical diagram checks). An optional fourth,
`export_pdf.py`, prints the same HTML to a language-specific PDF when a
handout is needed — never part of the default run. `$BATON` is
baton's install directory — in Claude Code `BATON="${CLAUDE_SKILL_DIR}"`,
otherwise the path baton was cloned to. Everything else in this pipeline is
you, with `git`, `gh`, `find`, and your own judgment.

**Wall-clock discipline.** A packet run once took 20 minutes; most of the
overrun was serial fetching and rediscovering fixed knowledge. The rules that
keep a run short, without touching any quality gate:

- **Batch independent commands.** One `gh` call with several `--json` fields
  beats four calls; independent `git`/`gh`/`find` probes go in one message.
- **Cold session** (packaging work whose history is *not* in your context):
  fan §1 out to parallel subagents — one for git + PR + issue, one for
  transcript mining — and read the design docs yourself meanwhile. A warm
  session skips all of that: the compaction is already in your head.
- **Never reverse-engineer the machinery.** The packet spec is written down
  in `spec.md`; reading `render.py` or the template to rediscover it is the
  single largest known waste.
- **Draw in parallel.** Each diagram can go to a subagent (which loads
  `diagram-design` itself, keeping your context lean) while you write §2's
  compaction — the two workstreams share nothing. Hand the subagent the
  structure, the packet palette, and the embedding contract; check its output
  against the contract like any other source.

## 1. Ground truth: the session first, then whatever else exists

**The session is the floor.** What was attempted, what failed, what was
decided and why — that lives in your context window and nowhere else, and it
is enough on its own. A debugging afternoon with no branch, a local
experiment, a refactor you never pushed: all packable. Never refuse for want
of a repo.

Everything below is **an enhancement you add when you find it**. Look for each,
use what is there, and say nothing about what is not.

**Where the work lives — decide before touching the filesystem.** Read the
session's own actions, not the shell's cwd (a cwd always exists; it is not
evidence):

- If the session's edits, tests, or commits targeted the local tree, the work
  lives in this repo: the packet is written beside it, and the eyebrow names
  the local branch and range.
- If the session operated on a remote object — reviewing a pull request
  through `gh`, working an incident, another repo's issue — and the local
  checkout was only the vantage point, the work lives remotely. The eyebrow
  names the remote subject (`repo · PR #N · <sha range>`), and packet files
  (`.baton/`, the rendered HTML) go to the runtime's scratch directory, never
  into the local working tree — they would land in the version control of a
  repo the work is not about. Deliver the published URL.
- Mixed session: the subject is where the session's *deliverables* went. Files
  created locally as side-products of remote work do not make the work local.

**If there is a git repo** — the commits are a second, independent record of
the same work:

```
git log --oneline -20                    # what actually landed
git diff --stat <range>                  # where it landed
git log --format='%s' <range> | grep -oE '^[a-z]+\(([^)]+)\)'   # the authors' own scopes
```

For the range: if the work is on a branch off a mainline, `git merge-base HEAD
origin/<base>` is the boundary. If it is uncommitted, or on a long-lived
branch with no clear fork point, say the range is the session's own edits and
scope by what you touched. **Never hand-pick a commit count** — no `--since`,
no counting backwards. A hand-picked range pulls neighbouring work in, and a
page titled for one feature ends up carrying another team's changes.

**If there is a pull request** — it holds what the repo does not: why the work
was done, what review pushed back on, whether CI passed.

```
gh pr view --json number,title,body,baseRefName,reviews,comments,statusCheckRollup
gh pr diff <N>
```

A `CHANGES_REQUESTED` round is an abandoned approach with its reasoning
attached — the most valuable thing in a forge and the first thing a summary
throws away.

**If there are design documents** — `find`/glob for `design*.md`, `docs/**`,
`*spec*.md`, `openspec/**` and the like, then **read them**. Look every time:
a documented diagram is the structure to reuse, and finding one is the
difference between a drawing that matches the system and one you inferred.
When there is none, you still draw — from the code, labelled as inferred
(`diagrams.md`). An automated
finder demonstrably missed a design doc that a plain `find` located; cast the
net wide and let reading, not filename rules, decide what matters. Their
diagrams are better than any you would draw (`diagrams.md`).

**If the change touches a database** — find the migrations and read the SQL.
Whether one is reversible, destructive or locks a table is your judgment from
the statements. A migration added and withdrawn inside the change is still
part of the story: read it at the revision where it existed
(`git show <sha>:<path>`).

**If it is not a code change at all** — an investigation, an incident, a
decision reached in conversation — the session is the whole record, and the
enhancements simply do not apply. The packet is not weaker for it; it is
scoped to what actually happened.

How to scope components to the session's work, and the judgment calls in
grouping and naming them: `extraction.md`.

Whatever is missing, its section is omitted and the packet says so. Silence,
never a guess.

## 2. The context: three layers, all complete

The embedded context is what the receiving agent resumes from. A 5KB digest
was shipped once and the agent it reached could answer nothing the diff did
not already say. Three layers, in this order — a packet missing any of them
is broken:

**(a) The record — what already happened.** Whatever §1 turned up, carried
through **whole, never summarized**: this layer is primary source. When there
is a repo, every commit subject in the range. When there is a pull request,
its body and every review round — who, the verdict, and the substance of what
they asked changed, because a `CHANGES_REQUESTED` round is an abandoned
approach with its reasoning attached. When there are design docs, their key
contracts. When there is none of that, this layer is the raw record the
session itself produced: the commands run, the outputs that mattered, the
errors hit. A packet with no repo still has a record.

**(b) The author's compaction.** The **complete `/compact` of the working
session** — not a digest, not highlights. You did the work; the history is
already in your context window. Write it from there: **every** workstream,
not just the headline one; every decision and its reason; every path tried
and dropped and how it died; every open question; every trap. Length is never
the constraint; completeness is.

For a session you did not run, the history lives in the transcript JSONL
under `~/.claude/projects/<slug>/`. Do not pipe the whole thing into your
context — filter it down to the turns that carry intent, with a short inline
command, e.g.:

```
jq -r 'select(.type=="user") | .message.content' <transcript>.jsonl   # direction
grep -n '"is_error":true' <transcript>.jsonl                          # dead paths
```

User turns are where direction changed; failed commands are where paths died.
Read those, then write the same complete compaction an author would.

**(c) How to pull more.** The receiving agent must never be capped by what
the author compressed. Close the context with explicit fetch instructions,
real values filled in:

```
gh pr view <N> --json body,reviews,comments   # every review round, verbatim
gh pr diff <N>                                # the change itself
git log <merge-base>..<head> --oneline        # the commit record
```

plus the design docs and source files worth reading first, by path. The
context tells the agent where to go; it never pretends to be the last word.

> **The failure that kills the packet:** shipping layer (a) alone, or a thin
> digest of it — commit list, schema counts, state names. The receiving agent
> could have generated every line of that from `git log` without you. If the
> context contains nothing that exists only in the session, layer (b) is
> missing, however finished the rest looks.

Open with the refusal declaration verbatim; `render.py` and `verify.py` both
enforce it:

```
> This is a compressed working history. Answer only from what is below.
> If it is not here, say you do not know and suggest asking the author.
```

## 3. Diagrams: the design doc knows the structure; `diagram-design` draws it

If the repo has a design document with diagrams, **read it for the
structure** — you understand mermaid natively; there is no parser between you
and the source. Keep the structure and every branch exactly, keep the latin
node ids, reword the labels for the audience. A maintained diagram is the
author's own model of the system; a sequence diagram invented from imports is
not a worse version of it, it is wrong. Only when no design document exists
do you take the structure from the imports and tree you read yourself,
labelled as inferred.

Drift is also yours to check: read the doc's states and the code's states and
compare. A documented state the code no longer accepts — or the reverse — is
a finding for the packet, not something to silently paper over.

**Per-item work gets per-item drawings.** When the ask is to explain each
unit of work specifically — each commit, each bugfix, each migration step,
each finding — a page of prose entries wastes what HTML can do that a commit
log cannot. Give every named item its own small figure: the mechanism it
changed, what it did before and what it does now. The per-change `vuln`
card is the proven instance (one card, one `figures.before_after()` drawing
per change — a text-only list shipped once and was rejected by its reader;
cards whose AFTER only said "no longer X" were rejected three times); apply
the same shape to any enumerable work, not only fixes. AFTER is the new
behaviour, stated concretely — `diagrams.md` § Per-change before / after.
Generate the set from one layout function so ten small diagrams stay one
visual system, and keep prose to captions and connective tissue.
`stats`/`bars` blocks are the floor for an item whose story genuinely is one
number; they never substitute for the mechanism drawing when there is a
mechanism to draw.

**The drawing itself goes through the `diagram-design` skill** — never
hand-written SVG, never mermaid in the packet. It carries forty diagram
types, semantic-pattern routing, a 4px grid, connector rules and a
pre-output quality gate; reimplementing any of that here would drift. Hand
it the type, the structure, and the packet's palette as brand tokens. Its
output is a standalone HTML file; extract the inline `<svg>` into the figure
section's `svg` field, meeting baton's three embedding conditions: colours
as the packet's CSS variables rather than hex, so the diagram survives the
theme switch; `data-node="<latin-id>"` on every selectable shape, so the
interactive statemap has something to bind to; `data-en`/`data-hant`/
`data-hans` on every `<text>`, so a language switch re-labels without moving
geometry. Strip the Google Fonts link the file carries — the packet must
render offline and inside a sandboxed iframe. The full contract and the
failures behind each condition: `diagrams.md`.

The **schema story** is transitions-as-transactions: each state edge opened
into the one database transaction that implements it, the writes outside the
transaction visually set apart, every transition the code has — and never a
standalone "schema changes" timeline page. The full treatment, and the
failures behind each rule, are in `diagrams.md`.

## 4. Wording: the eli5 skill

Invoke **`eli5`** with the audience — Product Manager, Director, Engineer. It
holds what each audience cares about; do not restate its rules.

The register test is **presentation, not vocabulary**. A page about a
database says `payment_attempts` and `status_log` — the most precise words
available, and translating them costs the reader the word they need with an
engineer afterwards. Terms are marked (backticks → `<code>`) or listed in the
packet's glossary; what fails the check is an identifier sitting bare in a
sentence. `verify.py --register eli5` enforces exactly this.

**Keep the mechanism's proper nouns at the key steps.** Business language is
for the flow, not for erasing what the flow *is*. "Confirm payment" is a
failure where the real step is "signs an EIP-2612 permit"; a PM handing this
off must be able to name the mechanism — EIP-2612, EIP-712, SIWE, the
endpoint it calls — not a euphemism for it. Simplify the connective tissue,
never the load-bearing term.

## 5. The page: baton's template

**The spec's exact shape — every field, kind and block — is `spec.md`. Read
that; do not grep the template or `render.py` to rediscover it.**

`render.py` fills `templates/packet.html` — a scroll deck / one-pager, a
document that presents, read more often than it is presented. Its machinery is
built in: the outline sidebar you walk, per-step reveal, `clamp()` scaling for
any screen, a light and a dark theme, the three-language switch (EN / 繁 / 简),
and the palette diagrams take their colors from — by meaning, never a
grayscale of their own (`diagrams.md`). You feed it the packet spec; you do
not hand-build a page. This is the one step where a script genuinely beats
you: it fills the template and escapes the payloads — mechanical assembly no
agent should emit by hand.

**Prose sections are blocks, not a paragraph.** A section whose `text` is one
long string renders as a grey slab and gets skimmed — which wastes the one
part of the page that carries the argument rather than the picture. Pass an
array instead, and let the shape follow the content:

| block | when |
|---|---|
| `{"h": …}` | the argument turns — a sub-head every few paragraphs, naming the turn |
| `{"p": …, "lead": true}` | the opening claim, set larger |
| `{"p": …}` | one idea per paragraph; if it needs a semicolon and two clauses, it is two |
| `{"note": …}` | the caveat or the aside that would otherwise derail a paragraph |
| `{"stats": [{"n": "~10s", "k": …, "tone": "accent"}]}` | two to four numbers that are the finding — a tile row reads at a glance where a sentence does not |
| `{"bars": {"rows": [{"k": …, "v": 5000, "label": "5s", "tone": "accent"}]}}` | a comparison of magnitudes, scaled to the largest row |
| `{"kv": [[k, v], …]}` | short definitional pairs — a term and what it means, a field and its value |

Reach for `stats` and `bars` **inside** prose whenever a sentence is carrying
numbers. They are small on purpose: not a replacement for the section's
figure, but the thing that stops "about ten seconds, of which five are the
gateway's" from being read as words. Every block takes the three languages
like anything else, and `**bold**` and `` `code` `` work inside them.

Do not turn every section into blocks reflexively. A section that genuinely is
one paragraph stays one paragraph — a string is still valid and still right.

**Name a finding's tag rather than taking the default.** A `points` item's
`tone` sets the colour; its printed words default to a migration packet's
vocabulary, where `risk` reads "cannot be undone". On a finding that is a
contradiction between a document and the code, nothing is being deleted and
that label is simply false. Pass `"tag": "the code says otherwise"` — a short
latin phrase, the same across languages, saying what kind of finding it is.

What the template carries that a plain deck would not:

- an outline that is a rail, not a column: numbered ticks pinned at the left
  edge, the full list sliding out on approach. The content column keeps the
  whole width, which is what pays for the larger type and the larger figures —
  do not add a second persistent sidebar and spend it again
- the embedded context in `<script type="text/markdown" id="baton-context">`
- the copy chain, three rungs: async clipboard → `execCommand` → a panel with
  the text already selected. The last rung needs no permission anywhere,
  which matters because a published page runs in an iframe that often denies
  the clipboard — and the reader's agent may be Claude Code, Codex, Cursor or
  anything else, so the context is plain markdown with no integration assumed
- a download button (`.md`) beside the copy
- the glossary and the refusal declaration

## 6. Verify

```
python3 "$BATON/scripts/render.py" .baton/packet.json -o baton-<slug>.html
python3 "$BATON/scripts/verify.py" baton-<slug>.html --register <eli5|engineer>
```

`verify.py` is light on purpose: it scans, it does not judge. It catches the
absences a reading agent is bad at noticing — the refusal declaration dropped
from the embedded context, a context short enough to be a digest (§2's
failure), a change card whose AFTER is missing, vague or only the negation of
its BEFORE (the before/after gate, `diagrams.md` § Per-change before / after),
and under `--register eli5` an identifier sitting bare in a human
sentence (points, ledes, transaction text). It skips diagram markup
entirely: its structure came from a source you read, and scanning it with the
prose-register check would reject every correct diagram ever drawn.
Fix what it reports; never `--force`. A packet that misleads its reader is
worse than none, because after it the reader stops verifying.

Diagram correctness has two gates. First the mechanical one:

```
python3 "$BATON/scripts/snapshot.py" baton-<slug>.html -o <scratch-dir> --primary <lang>
```

It renders the page in headless Chrome, fails the run on what a script *can*
catch — a `<text>` missing one of the three language attributes, a label
wider than the box or mask it sits in (measured per language), CJK below
12px, a blank section, `[object Object]` — and only then produces the
screenshots: every step in the primary language, the figure steps in the
other two, and the clipboard-fallback dialog. Fix and re-run until it passes;
this is what used to cost a full render-read-patch-render loop.

Then the gate that counts: **read those screenshots with your own eyes** (or
open the page in a live browser when one is connected). Not skippable, and no
script substitutes: a page was once published on script checks alone and was
completely broken — blank panels, `[object Object]` in headings, counters
bleeding onto buttons. Check:

- every section builds and shows its content — no blank panels
- no `[object Object]` anywhere — a template stringified a value it should
  have rendered
- language switching leaks nothing: on a Chinese page no English survives
  except marked code terms
- every diagram legible — no overlapping or truncated text, no source ids in
  visible labels
- the copy button reaches its fallback: block the clipboard (an iframe does)
  and confirm the selected-text panel appears

Only after this does the page publish.

## 7. Publish

Write the file beside the work — never a temp directory. "Beside the work"
follows §1's where-the-work-lives call: a local-subject session writes next to
the repo it changed; a remote-subject session has no local "beside" — its
files stay in the scratch directory and the URL is the deliverable. Then
publish with the **Artifact** tool and hand back the URL. That URL is what gets pasted
into Slack; the reader installs nothing, and the local file and the published
page behave identically, packet included.

**Optional PDF handout** — only when the reader asked for a PDF, or a file is
clearly needed for email / print. Never part of the default build (keeps
packet runs short). Print the **same** HTML so layout and colours stay
identical; do not redraw, do not build a PPT.

```bash
python3 "$BATON/scripts/export_pdf.py" baton-<slug>.html --lang hant -o baton-<slug>-hant.pdf
```

`--lang` is `en` | `hant` | `hans`. Default theme is light (formal handout).
The page also has a **PDF** button that opens the system print dialog for the
current language.
