# Components: every section is a picture of something real

A packet is read in minutes. Sentences are read last, skimmed, or not at all,
so a section is a **component** — a chain, a map, a table of from → to, a
matrix, a row of steps, a row of numbers — with at most a two-sentence lead.
Everything here renders as HTML in `rem`, so labels stay legible on a laptop
and on a projector; nothing is text inside a scaled-down SVG.

`verify.py` enforces the limits below. Fix a failure by choosing the component
that fits, never by trimming words until the counter stops.

## Pick the component by what you are showing

| you are showing | component | limits |
|---|---|---|
| a change, a fix, a claim, a failure path | `chain` | 3–6 nodes, code labels ≤ 24 chars, hop labels ≤ 16 |
| where systems meet, what is wrong there, and how each one fails | `boundary` (always last) | ≥ 2 systems, every pin links a `chain`, a `failures` row per failure mode |
| error codes or symptoms and what on-call does | `runbook` | system map above, every row has `at`; never a `compare` (spec.md § runbook) |
| old vs new, option vs option | `compare` | ≤ 6 rows of [dimension, from, to] |
| cases × properties, claims × proof | `matrix` | ≤ 12 rows, one mark per cell |
| an order of operations, a rollout | `steps` | 3–5 steps |
| two to four numbers that are the finding | `stats` (or a `stats` block in a lead) | 2–4 tiles; optional `trend` sparkline |
| measured data over time, across groups, or through stages | `chart` (line / bar / stacked / funnel) | 1–4 series, one axis, `source` required |
| system architecture with branches | `figure` (SVG via `diagram-design`) | ≤ 960 wide, labels ≥ 13px |
| open questions | `points` with `"role": "questions"` | ≤ 6, one sentence each |
| a lead | prose | ≤ 3 paragraphs, ≤ 480 chars (en); over 300 needs a stats row |

Retired: `vuln` (the three-box before/after) and `points` for findings or
risks. Both read as text; a finding is drawn as a `chain`, a risk is a pin on
the `boundary` map.

## chain — the change on the real component chain

Two lanes, BEFORE and AFTER, draw **the same chain of real components** —
client, proxy, service, store, consumer, OS, third party. BEFORE marks the
node(s) where it breaks; AFTER marks the node(s) that changed. A callout hangs
off the marked node and says **why that hop produces that outcome** — the
mechanism, with the identifier, not the conclusion.

```json
{"kind":"chain","heading":i18n,"tag":"must handle","tone":"warn|risk",
 "claim":i18n,                       // one sentence: what this change claims to make true
 "nodes":[{"id":"app","name":i18n,"kind":"client|service|store|external"}],
 "before":{"sub":{"app":"code label" | i18n}, // what each node does in this lane
           "hot":["dev"],                     // the broken node(s)
           "hops":{"0":"token X"},            // optional: what flows on hop i → i+1
           "why":{"at":"dev","text":i18n},    // the mechanism at a hot node
           "outcome":i18n},                   // the observable result
 "after":{... same shape; hot = the changed node(s); why = why this fixes it},
 "proof":[{"type":"test|ci|e2e|source|grep|schema|log|manual",
           "label":i18n,"state":"verified|code-only|absent"}]}
```

Rules:

- **Real nodes only.** Name the component as it exists — `SyncDevice`,
  `devices_wallets`, `nginx filter.lua` — never "backend" or "the system".
- **The callout carries the reason.** BEFORE's `why` explains the mechanism
  that breaks; AFTER's explains why the change removes it. If you cannot write
  it with an identifier in it, you have not found the mechanism yet.
- **AFTER states what happens now** (`verify.py` rejects "no longer X").
- **Proof is not optional.** A claim with no proof is shown with `absent`
  chips — that is honest, and it is the reviewer's to-do list. Never mark
  `verified` without a run, a read source, or a log you can point at.
- **Every chip states its `state`.** There is no default: `verify.py` fails a
  chip without one, and the page draws it as "state not given", never as
  `verified`.
- A plain string in `sub` is a code term (mono); an i18n object is prose.

## boundary — the map that ends every packet

The systems come from the packet's one `systems` map (spec.md § systems) —
the target state when the packet has an after architecture — so the boundary
map, the runbooks and the architecture / sequence figures show the same boxes.
Every failure row is numbered, and the number is printed on the map where the
row fails; in the table, the number links back to that place.

**One row per failure mode, one place.** When the packet has `runbook`
sections, every failure row lives in a runbook and the boundary map keeps only
its pins (design gaps) — `verify.py` refuses `failures` on the map beside
runbooks, and the same mode (`at` + its name before " — ") twice across
runbooks. Without runbooks, the rows stay in the map's `failures`.

The systems the work crosses, left to right, with each finding as a numbered
pin on the node or the link where it lives. Links without a finding render
green: checked and fine. See `boundary-review.md` for how findings are chosen.

```json
{"kind":"boundary","role":"boundary-review","heading":i18n,"caption":i18n,
 "systems":[{"id":"app","name":i18n,"kind":"client"}, ...],
 "sub":{"app":"X-INSTALL-ID"}, "hops":{"0":"HTTPS"},
 "findings":[{"n":1,"at":"res" | "res>dev","lens":"coexist","tone":"warn",
              "title":i18n,"card":"<en heading of the chain card that draws it>"}],
 "ok":i18n,                                   // only when findings is empty
 "failures":[{"at":"push>fcm",               // a system id, or "a>b" for a link the map draws (a next to b)
              "mode":i18n,                    // what fails
              "detect":i18n,                  // the signal before a user complains; omit → "no signal today"
              "impact":i18n,                  // what the user sees
              "action":i18n,                  // the runbook step
              "ref":"https://github.com/<owner>/<repo>/blob/<sha>/<path>#L12-L18",  // omit → "no code reference"
              "state":"handled|detected|unhandled",
              "introduced":true,              // optional: this work opened the mode
              "finding":1,                    // the pin that draws it — required when introduced + unhandled
              "source":i18n,                  // proposal route: the document sentence it comes from
              "planned":true}]}               // proposal route: the code does not exist yet
```

`failures` is the failure-mode table (`boundary-review.md` §3): exhaustive,
one row per way a boundary fails, rendered under the map grouped by
boundary as mode · signal · user impact · runbook · evidence · state.
Clicking a system or link on the map highlights its rows.

- `state` is one of `handled` (needs `ref` or, on a proposal, `source`),
  `detected` (needs `detect`), `unhandled`. No default.
- `ref` is `https://` only, at most 2048 characters, and opens in a new tab through the page's link
  sanitizer (`rel="noopener noreferrer"`). The host must be the one the
  browser opens: plain ASCII, no port, trailing dot, userinfo or
  percent-escape, and no backslash, empty (`//`) or `.` / `..` segment
  anywhere; a GitHub path carries no `%` escape (GitHub folds `//` and
  decodes `%xx`, which would open a fork or a branch the checks never saw). A
  GitHub `blob` / `blame` / `raw` link, or a `raw.githubusercontent.com`
  (or `raw.github.com`, or a `media.githubusercontent.com/media/` LFS) one, must be a file permalink pinned to a commit SHA,
  never a branch (write the full 40-hex SHA: a short one is accepted, and a
  branch named like hex would pass for it) — tree, edit and history routes are
  refused; the page labels it
  `owner/repo · file:La–Lb`, and any other GitHub link also leads with
  `owner/repo`, so a fork cannot pass for the real repository.
- `finding` names a pin on the **same** boundary (`at` equal to the row's).
- Required on the `engineer` register (`verify.py` fails a boundary section
  without the key; on `eli5` it warns). `[]` is allowed and warns for each
  link that no row — on the link or on either end system — and no `ok`
  covers (with pins on the map `ok` is not allowed, so add the rows). A packet written before this field gets that one clear message,
  never a crash.

## compare, matrix, steps, stats

```json
{"kind":"compare","heading":i18n,"caption":i18n,"cols":[dim,from,to],"rows":[[i18n,i18n,i18n]]}
{"kind":"matrix","heading":i18n,"caption":i18n,"cols":[i18n],
 "rows":[{"k":i18n,"v":["have","part","gap","plan","na"]}],"legend":{"have":i18n}}
{"kind":"steps","heading":i18n,"caption":i18n,
 "steps":[{"fn":"1 · DB","title":i18n,"text":i18n,"tone":"accent|warn|ok"}]}
{"kind":"stats","heading":i18n,"items":[{"n":"0/8","k":i18n,"tone":"warn"}]}
```

`compare` draws the old value muted and the new one strong, so the eye goes to
the new state. `matrix` marks are `have ✓`, `part ~`, `gap ✕`, `plan ○`,
`na —`; the legend names what each means for this table.

## chart — measured data, drawn at the page's real width

```json
{"kind":"chart","heading":i18n,"caption":i18n,"type":"line|bar|stacked|funnel",
 "x":["21:00", ...],                       // categories or times, in order
 "series":[{"name":i18n,"values":[18, 18, ...]}],   // 1–4 series; funnel exactly 1
 "unit":"%",                               // optional suffix on ticks, labels, tooltip
 "marks":[{"at":7,"label":i18n}],          // line only: a vertical rule at x index
 "source":i18n}                            // required: query, dashboard or file
```

Built on the `dataviz` method: categorical slots `--s1…--s4` validated with
`validate_palette.js` against this page's card surfaces (light `#ffffff`,
dark `#393e53`); thin marks (2px lines, bars ≤ 24px with 4px rounded ends,
2px gaps in stacks); one axis starting at zero; a legend only for ≥ 2 series;
direct labels at line ends and bar tops, never on every point; a hover/focus
tooltip on every mark (crosshair on lines); and a **data table** under every
chart — the palette's contrast warning makes that table mandatory, and it
keeps every value reachable without hovering. Text never wears a series
colour.

Rules:

- **Real data only, with its source.** A chart without `source` fails
  `verify.py`. Never invent illustrative numbers in a packet.
- **One axis.** Two measures of different scale are two charts.
- **Funnel** = one series of stage counts; the page prints the conversion
  between consecutive stages.
- A `stats` item may carry `"trend": [numbers]` — a sparkline under the
  number, current point in the accent.
