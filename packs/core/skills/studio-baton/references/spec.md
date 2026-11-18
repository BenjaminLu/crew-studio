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

### figure

```json
{"kind":"figure", "heading":…, "caption":…, "svg":"<svg …>…</svg>",
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
