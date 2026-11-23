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
| where systems meet and what is wrong there | `boundary` (always last) | ≥ 2 systems, every pin links a `chain` |
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
- A plain string in `sub` is a code term (mono); an i18n object is prose.

## boundary — the map that ends every packet

The systems the work crosses, left to right, with each finding as a numbered
pin on the node or the link where it lives. Links without a finding render
green: checked and fine. See `boundary-review.md` for how findings are chosen.

```json
{"kind":"boundary","role":"boundary-review","heading":i18n,"caption":i18n,
 "systems":[{"id":"app","name":i18n,"kind":"client"}, ...],
 "sub":{"app":"X-INSTALL-ID"}, "hops":{"0":"HTTPS"},
 "findings":[{"n":1,"at":"res" | "res>dev","lens":"coexist","tone":"warn",
              "title":i18n,"card":"<en heading of the chain card that draws it>"}],
 "ok":i18n}                                   // only when findings is empty
```

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
