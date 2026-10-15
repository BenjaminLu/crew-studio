# The intent-aligned merge card

The merge card was a text blob: no v1-style explanation and no step where the captain
checks the change against what was asked. Now the card carries a structured detail in
en and zh-TW, a walk of the diff, and an alignment step the server enforces.

Done when (`tests/intent-card.ts`, `tests/intent-card-ui.mjs`; both red on 17576c4, where
`src/domain/mergecard.ts`, `public/scard.js` and the `aligned` answer field do not exist):
1. R-002's merge card, rebuilt from a fixture of its real records (`tests/fixture/cards/R-002`:
   run context, spec, ledger, diff, absolute paths dropped), shows every section: intent (the
   captain's own sentence), why, scope in/out, done lines, before/after, how, walk, door and
   rollback, reviewer verdict and follow-ups, gates, cost and time. — "the merge card shows every section …",
   "intent: …" … "the six gates".
2. Each done line shows its proof: the checks that proved it, their ledger entries (seq, verdict,
   head), evidence links, and for fail-first the test that was red on base. — "done line N names its proof …",
   "each done line shows its proof: CI #29 and fail-first #30 …".
3. The walk lists the key hunks, each with a note and the intent lines and done lines it serves;
   each new test maps to exactly the done line it proves. — "each new test maps to exactly the done line it proves, in order",
   "the walk lists six hunks; each new test maps to its done line".
4. zh-TW renders real translations (the coordinator's); when the coordinator wrote none the
   lines are marked untranslated, never filled with a placeholder. — "zh-TW renders real translations …",
   "with the coordinator every line has a Chinese zh-TW text …", "with the stub coordinator the zh-TW lines are marked untranslated …".
5. A merge (any non-hold option) is refused until every intent line is ticked, or the captain
   writes a note; a one-way change also needs the door confirmation. The server enforces it
   (Cards.answer, the engine, `POST /api/scards/<id>/answer`). — "a merge with two of three ticked is refused …",
   "one-way: …", "Inbox: Merge with no tick is refused by the server …", "the answer route itself refuses …".
6. The same component works on the run page and in the Inbox; ticks survive live re-renders. — "run page: the ticks survive …",
   "run page: with both lines ticked the merge is taken and the ticks are recorded".
7. 1440 and 390, light and dark (all four), with no sideways scroll. — "R-002's merge card renders at …". Screenshots:
   `tests/out/intent-card-r002-{1440,390}-{light,dark}.png`, `tests/out/intent-card-r002-1440-light-zh.png`.

8. (review r1) A malformed coordinator answer never breaks the card: it falls back, marked. — "malformed coordinator answer #N …",
   "mergeDetail itself never throws …".
9. (review r1) The evidence route serves a listed file and refuses an unlisted file, a `..` path and a symlink out of the
   folder; the `/file` route refuses the same symlink. — "the evidence route serves …", "… refuses …".
10. (review r1, the captain's decision) An authorization window leaves a merge card open and still answers a dispatch card.
   — "an authorization window that lists merge leaves the merge card open …", "the same window still answers a dispatch card".
   The generic runtime knows no card kinds: the merge body sets `captainOnly: true` (new optional `Body`/`SCard` field)
   and the engine's window skips such cards. — also "… is captain-only (an authorization window never answers it)" in tests/smoke-code.ts.
11. (review r1) Without the coordinator the done lines' zh-TW is marked untranslated too. — "without the coordinator the done lines, why, … are all marked untranslated".

12. (rebase onto visual-sandbox) The app's before / after captures (`SCard.captures`) render inside the before/after
   section: the two pictures side by side, the visible text that changed under each, and the card's links (Open the app)
   beside them; a card without a detail shows the same section. — "the merge card's before/after section holds the app
   captures side by side …"; `tests/runtime-ui.mjs` keeps its `[data-captures]` / `[data-card-link]` checks.

## Card contract: fields added (additive, `src/runtime/cards.ts`)

- `SCard.detail?: CardDetail | null` — older cards have none and render from `sections` and `body`.
  `CardDetail` = `{ intent, intents[], why[], how[], scope {in, out}, done[{ text, proved, proofs[{ check, seq,
  verdict, head, detail, evidence[{label, href}] }] }], beforeAfter { text, stat, images[] }, door { kind, reason,
  rollback } | null, review { verdicts[{by, verdict}], followups[] } | null, cost { usd, rounds, minutes } | null,
  gates[{ name, verdict, detail }], walk[{ id, file, start, lines[], note, serves { intents[], done[] } }], run, head,
  base, writer: "coordinator" | "fallback" }`. Every text is `L10n = { en, "zh-TW", untranslated? }`; indexes are 0-based.
- `SCard.answer.aligned?: number[]` — the intent lines ticked, recorded on cards with intent lines.
- `Cards.answer(id, { …, aligned })`, `Engine.answer(id, { …, aligned })`, and the HTTP body `{ choice, note, confirm, aligned }`.
  Rule: a card with `detail.intents` takes a non-hold answer only with every index ticked or a non-empty note.
- `SCard.captainOnly?: boolean` / `Body.captainOnly`: an authorization window never answers such a card. The merge body
  sets it (the captain's decision: intent alignment is the captain's own act); other cards, such as dispatch, are
  answered by a window as before.
- `Body.detail` (engine) passes through to the card; `engine.cardBodies[kind]` may now return a Promise.
- `GET /api/wruns/<id>/evidence?seq=N&file=…` serves one evidence file a ledger entry lists (proof links). It and the
  run's `/file` route realpath the file itself (`secure.ts` `realInside`), so a symlink never leads out of the folder.

The merge body (`src/domain/code.ts`) builds the detail with `src/domain/mergecard.ts` and asks the
workflow's coordinator role (tool `card_detail`) for the zh-TW text and walk notes; on any failure the
deterministic detail stands, zh-TW marked untranslated. The coordinator's answer is validated against its schema
inside that guard (`validCoordinator`, `coordinatorDetail`): any malformed field, wrong count or unknown hunk id
rejects the whole answer and the card keeps the fallback. The card's zh-TW sections mark untranslated lines
"（未翻譯）", done lines included.

## The shared component: `public/scard.js`

Load `/scard.js` (index.html already does, before runtime.js). Then:

```js
const ctl = window.crewCard.mountCard(el, card, { onAnswered, inbox, lang });   // also window.mountCard
ctl.update(card);   // re-render with fresh card data, keeping ticks, note, door tick and opened walk items
```

- `el`: any element; its content is replaced. It gets `data-scard=<id>`, `data-card-status` and class `rt-card`.
- `card`: a Studio card as `GET /api/scards` returns it (with or without `detail`).
- `onAnswered(card)`: called with the server's updated card after an answer is taken (refresh your list here).
- `inbox: true` adds the run / workflow / node line; `lang: "en" | "zh-TW"` picks the first language (default: the page's);
  the card has its own EN / 繁中 toggle.
- It renders all sections, the walk, the intent ticks, the door confirmation, a note box, the option buttons
  and the result: the answer inline on success, the server's refusal text in `[role=status]` on failure. A button that is
  not ready has `data-ready="false"` and a title that says what is missing; it still asks the server, which decides.
- Keep one mounted element per card across your page's re-renders (see `cardView` in public/runtime.js), or the
  captain's ticks are lost on every live update.
- Test hooks: `[data-sec=<section>]`, `[data-done=i]`, `[data-proof=<check>]`, `[data-walk=<id>]`,
  `[data-serves-done=i]`, `[data-intent-tick=i]`, `[data-confirm-door=<id>]`, `[data-option=<id>]`, `[data-card-lang]`,
  `[data-card-msg]`, `[data-untranslated]`.

The Board mounts it too, in Needs you (docs/units/board.md). It passes `state`, an object it keeps per card id until
the card is answered, so closing and reopening a card keeps the ticks, note, door tick, refusal and an answer in flight.
`state` is optional; without it the state lives in the mount. One answer is in flight per card. A card already answered
with the same choice shows as answered.

Shared areas touched: `src/runtime/cards.ts`, `src/runtime/engine.ts` (Body.detail, async card bodies, `aligned`; an
authorization window skips captain-only cards), `src/runtime/index.ts` (answer passes `aligned`; evidence route; `/file`
realpaths the file), `tests/runtime-ui.mjs` and `tests/smoke-code.ts` (their merges tick the intent lines).
