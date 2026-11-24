# The packet spec, exactly

`render.py` fills `templates/packet.html` from one JSON file. This page is the
complete shape of that JSON — read it **instead of** reverse-engineering
`render.py` or the template; a full run was once spent rediscovering all of
this with grep.

Build it with a small script beside the packet (embed the SVG files and the
context markdown by reading them — never paste multi-KB payloads into JSON by
hand):

```python
spec = {...}                                   # everything below
spec["context"] = Path("context.md").read_text()
Path("packet.json").write_text(json.dumps(spec, ensure_ascii=False))
```

## Top level

| field | shape | notes |
|---|---|---|
| `format_version` | `"0.1"` | defaulted if omitted |
| `layer` | `"L0" \| "L1" \| "L2" \| "proposal"` | shown in the footer; `"proposal"` is required when the input is a document about work not yet done (`SKILL.md`), never `L0`/`L1` |
| `layer_note` | i18n | footer suffix, e.g. what was verified and when |
| `filename` | slug | download name for the `.md`; also the default output name |
| `repo` / `branch` / `range` | strings | joined with `·` into the eyebrow; omit any that don't apply |
| `title` / `subtitle` | i18n | page header |
| `sections` | array | one entry per outline step, kinds below |
| `systems` | object | **the one system map** — `{state, systems, sub, hops, groups}`; drawn by the boundary map and every `runbook`, and checked against the architecture and sequence figures (§ systems below). Required once a packet has a figure with `edges` or more than one map |
| `context` | string or list of strings | the three-layer markdown; **must contain the refusal declaration** (`render.py` and `verify.py` both hard-check for "say you do not know" / 「說不知道」/「说不知道」) |

**i18n values:** any human-facing string may be `"plain"` or
`{"en":…,"hant":…,"hans":…}`. A missing language falls back to `en` — which on
a Chinese page is a leak. Write `en` and `hant`; **`hans` may be omitted** —
`render.py` derives it from `hant` via OpenCC `tw2sp` (phrase-level, so
資訊→信息) and refuses the build if OpenCC is missing rather than serving
Traditional to a Simplified reader. Write `hans` explicitly only where the
wording should genuinely differ. This applies to spec JSON only — diagram
`<text>` nodes still carry all three `data-*` attributes themselves
(`snapshot.py` enforces that).

**Inline marks:** exactly three are honoured everywhere — `` `code` ``,
`**bold**`, and `[label](https://url)` (absolute http(s) only; anything else
stays literal, so a packet cannot smuggle `javascript:` or HTML).

**Code links — clickable, never cluttered.** When prose or a card describes a
fix or names code, link it to the exact GitHub line:

- The **link text is the identifier already on the page** — `file.go:123`,
  `#1322`, `pkg/safefetch/`. A link adds zero visual elements: no "click
  here", no icons, no raw URLs in prose. The template styles links as a quiet
  dotted underline that only takes `--link` colour on hover.
- **Pin to a commit SHA**, never a branch: `…/blob/<sha>/<path>#L<line>`
  (`/tree/<sha>/<dir>` for a directory, `/pull/<n>` for a sub-PR). A branch
  link rots the day the branch moves or merges.
- **Re-locate every line number at that SHA** with
  `git grep -n '<pattern>' <sha> -- <path>` before linking. Audit findings
  and design docs quote *pre-fix* lines; after the fix those numbers point at
  the wrong code, and a link that jumps to the wrong line is worse than none.
- Budget: the `vuln` card's `ref` line is where links live (sub-PR + the
  fix's `file:line`); in prose, link only the load-bearing identifier. If a
  sentence wants three links, the section wants a ref line instead.

## Section kinds

**Prefer the v2 components** — `chain`, `boundary`, `compare`, `matrix`,
`steps`, `stats` — whose shapes and limits are in `components.md`. They render
as HTML in `rem`. The kinds below remain for leads (`prose`), SVG
architecture (`figure`), open questions (`points` with `"role": "questions"`),
and database stories (`statemap`, `txn`). `vuln` is retired.

Every section takes `heading` (i18n). The default kind (no `kind` field) is
prose.

### prose (default)

`text` is one string **or** an array of blocks:

| block | renders as |
|---|---|
| `{"p": i18n, "lead": true?}` | paragraph; `lead` sets the opener larger |
| `{"h": i18n}` | sub-head where the argument turns |
| `{"note": i18n}` | bordered aside |
| `{"stats": [{"n": "13 / 23", "k": i18n, "tone": "accent"\|"ok"\|"warn"?}]}` | tile row — `n` is the number (plain string, no i18n), `k` the caption |
| `{"bars": {"rows": [{"k": i18n, "v": 5000, "label": "5s", "tone": …?}]}}` | magnitude bars, scaled to the largest `v` |
| `{"kv": [[i18n, i18n], …]}` | definition pairs; also works as a numbered list with `"1"`, `"2"` … as keys |

### systems — one map, the same everywhere

```json
"systems":{"state":"after",                       // "after": the system this work leaves behind; "today": as it runs now
  "systems":[{"id":"api","name":{"en":"Gateway API"},"kind":"service"}, ...],   // left → right, as the request flows
  "sub":{"api":":9001"}, "hops":{"0":"gRPC"},      // short: the map is one row of up to 8 boxes
  "groups":{"gw":{"name":{"en":"Push Gateway"},"parts":["api","db","worker"]}}} // one coarser box in a view
```

- **The map draws the target.** When the packet has an `"after"` figure,
  `state` is `"after"` — the boundary map and runbooks show the system after
  the change, never production as it is today (`verify.py` fails it).
- **Every view of the same state draws the same systems.** Each figure with
  `edges` declares `"view": "architecture" | "sequence"` and
  `"state": "before" | "after" | "today"`. For the figures whose state equals
  `systems.state`, `verify.py` requires: every map system is drawn (by its id,
  or by a `groups` id covering it); every node the figure draws is on the map,
  in a group, or listed in the figure's `"context": [...]` (周邊 boxes such as
  an ops console); and each node's SVG label contains the map name.
  Node ids come from `"nodes": [...]` when given, else from the `edges` ends.
- Boundary and runbook sections omit `systems` and inherit this map; if one
  carries its own it must equal it.

### runbook — error code or symptom → where it happens → what to do

```json
{"kind":"runbook","heading":i18n,"caption":i18n,
 "rows":[{"at":"worker>fcm",            // a system id or "a>b" link on the map — required
          "mode":i18n,                 // the error code or symptom, as on-call sees it
          "today":i18n,                // optional: what production does now (shown under the mode)
          "detect":i18n,"impact":i18n,"action":i18n,
          "ref":"https://github.com/<o>/<r>/blob/<sha>/<path>#La-Lb",
          "state":"handled|detected|unhandled"}]}
```

The page draws the system map, numbers every row, and prints those numbers at
the system or link where the row fails; selecting a place marks its rows, and
a row's number is a link back to its place on the map (focus moves there; Enter
then marks it).
Rows follow the boundary `failures` rules (`components.md` § boundary). A
runbook, failure-mode or error-code table is **never** a `compare` or
`matrix` — `verify.py` fails one by its heading or columns.

**Search.** Every page has full-text search (`/` focuses it): runbook and
failure rows rank first, and opening a hit marks the row and its place on the
map. `page.html#q=UNREGISTERED` opens the first hit, so an alert can link
straight to its runbook row.

### figure

```json
{"kind":"figure", "heading":…, "caption":…, "svg":"<svg …>…</svg>",
 "view":"architecture|sequence", "state":"before|after|today",   // required with edges (§ systems)
 "context":["ops"],                                               // nodes deliberately off the system map
 "edges":[{"from":"nodeA","to":"nodeB","evidence":"where this line comes from"}]}
```

`svg` is the inline diagram (contract below). `edges` never renders — it is
`render.py`'s integrity check: any edge without `evidence` refuses the build.
List one entry per drawn connector, evidence = the commit / doc / command that
proves the line.

### points

```json
{"kind":"points","items":[{"tone":"risk"|"warn"|"ok","tag":"short latin phrase","text":i18n}]}
```

`tone` sets the colour. **Always set `tag`** — the defaults are a migration
packet's vocabulary (`risk` prints "cannot be undone") and are usually false
for other finding types.

Findings and risks are not `points`: they are `chain` cards and pins on the
`boundary` map (`components.md`). `points` is kept only for
`"role": "questions"`.

### statemap / vuln / txn

Interactive state machine, vulnerability card, and transaction envelope —
shapes in `diagrams.md` (statemap) and the template's `vulnHTML`/`txnHTML`:

- `vuln`: `severity` (`p0|p1|p2`), `before`, `after`, optional `svg`,
  `problem`, `fix`, `ref`. **`before` / `after` are required** (i18n): what the
  system observably did, and what it observably does now — the new value,
  error, state or call, with a `code` term, a number or a quoted value in it.
  AFTER is never "no longer X" (`diagrams.md` § Per-change before / after);
  `verify.py` fails the page otherwise. Draw `svg` with
  `scripts/figures.py` `before_after()`; a hand-drawn figure must carry
  `data-node="before-outcome"` and `data-node="after-outcome"` boxes.
- `txn`: `method`, `summary`, `text`, `tables:[{table, op:"INSERT"|"UPDATE",
  guard?, fields:[{k, now, was?, tone?, why?}]}]`, `outside:[[name, i18n]]`,
  `takeaway`, `foot`.
- `statemap`: like figure plus `detail` (`nodeId → txn object`) and `stages`
  (`nodeId → "expand"|"backfill"|"cutover"|"contract"`), optional `hint`.

## The SVG contract (what `diagram-design` output must be edited to)

The page owns theme and language; the diagram must inherit both:

1. **Colours as the packet's CSS variables, never hex.** Available:
   `--fg --muted --soft --card --card-2 --bg --rule --rule-strong
   --accent --accent-tint --amber --seal --ok --link`. The page legend fixes
   the meaning: `--accent` = this change (1–2 focal max), `--amber` = needs
   attention, `--seal` = cannot be undone, dashed `--muted` = context.
   Keep the assignment identical across every diagram in the packet.
2. **`data-node="<latin-id>"`** on every selectable shape (rect/polygon).
3. **`data-en` / `data-hant` / `data-hans` on every `<text>`** — one missing
   attribute leaks English onto the Chinese page. Size boxes for the longest
   language; CJK never below 12px.
4. Diagrams sit on `var(--card)` (the figure body), so **paper masks and
   label masks are `fill="var(--card)"`**, not `--bg`.
5. **Prefix every `id`** (markers, `<title>`/`<desc>`) per figure — two inline
   SVGs on one page share a namespace, and colliding marker ids break arrows.
6. `data-edge` on connector `<path>`s and `data-node` on rects opt into the
   page's draw-in/pop animations. Keep them.
7. **No external fonts** — use `style="font-family:var(--sans)"` (names),
   `var(--mono)` (identifiers, ports, metrics), and strip any Google Fonts
   link from generated output.

## After building

```bash
python3 "$BATON/scripts/render.py"   .baton/packet.json -o baton-<slug>.html
python3 "$BATON/scripts/verify.py"   baton-<slug>.html --register <eli5|engineer>
python3 "$BATON/scripts/snapshot.py" baton-<slug>.html -o <scratch-dir>
```

`snapshot.py` (pipeline §6) runs the mechanical diagram checks and produces
the per-language screenshots you then read with your own eyes.
