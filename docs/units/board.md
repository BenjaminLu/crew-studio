# Unit board: one page for every run in flight and every decision waiting

What: a Board page, the home of the backbone sidebar (Board, Firstmate, Inbox, Crew, Runs, Workflows, Library), ported from the approved prototype's Board view (`.need`, `.rrow`, `.pipe`, `.crewline`). Three sections:

- **Needs you**: only the decisions waiting for the captain, Studio cards and firstmate cards alike: run or task, kind, a one-line why, age and an Answer button. The button expands the card in place (`crewBoard.mountDecision(el, decision)`: a Studio card is the shared `window.crewCard.mountCard` from public/scard.js, a firstmate card the Inbox's card view): options, note, intent ticks and the one-way confirmation, answered there with no navigation; the result ("… ✓", or the server's refusal) shows inline.
- **Runs**: every run in flight, one row each, Studio runs (`/api/wruns`) and firstmate tasks (the fm state readers): title and workflow, a stage pipeline bar (one segment per stage from `crewLayout.stagesFor`; done green, running blue and pulsing, waiting on the captain purple, failed red), "3/7 Build loop · round 2/3", a status badge, the crew working on it (vendor and model on hover), spend, elapsed. Rows update live from the page's one stream (`window.liveListen`); a click opens the run.
- **Crew on duty**: the live agents across all runs.

The subtitle reads "N runs, M crew on duty, $X today", from recorded job costs only.

The Inbox becomes decisions only: the captured-intents progress trail goes; a firstmate card is sent from the card itself (no confirm dialog) and its result shows on the card.

Why: the captain could not see the parallel workflows' progress (「看不到並行的workflow當前進度」), found the Inbox's status trail useless (「inbox裡的狀態進度沒有任何用處」), and could not answer a decision where it was shown (「也不能直接點擊確認互動」).

Done when (`tests/board-ui.mjs`, a fixture of three Studio runs in parallel, running in build round 2, waiting on its merge card, failed at CI, plus firstmate tasks; red on 17576c4, where #/board is the old task table and home is the Inbox):

1. Board is the home and the first backbone item. — "home is the Board, first in the sidebar".
2. The Board lists every parallel run with the correct segment states. — "the Board lists every parallel run with the correct segment states".
3. The label shows stage and round. — "the label shows stage and round".
4. Each row shows a status badge, the crew with vendor and model on hover, spend and elapsed; the subtitle has real counts and today's spend. — "row details and subtitle".
5. Needs you lists exactly the waiting decisions. — "Needs you lists exactly the waiting decisions".
6. A Studio card is answered inline from Needs you; the result shows inline and the row leaves Needs you. — "a Studio card already answered with the same choice shows as answered: Merge ✓ inline, and the row leaves Needs you", "a one-way Studio card in Needs you answers with the door tick".
7. A refusal shows inline. — "a refusal shows inline".
8. A firstmate card is answered inline from Needs you and from the Inbox (no dialog), through the board. — "a firstmate card is answered inline from Needs you", "a firstmate card is answered inline from the Inbox".
9. A live event updates one row without a reload. — "a live event updates one row without reload".
10. There is one stream connection. — "one stream connection".
11. The Inbox has no progress trail. — "the Inbox has no progress trail".
12. Screenshots at 1440 and 390, light and dark, beside the prototype's Board rendered at the same sizes, in tests/out/board/; no sideways scroll at 390. — "screenshots …".

Touches outside the unit's own files (public/board.js, public/board.css): backbone.js (nav order, home, the Inbox's intents embed removed), takeover.js (confirmSend sends in place), index.html (round 4: scard.js gains `opts.state`, one answer in flight and the same-choice answer), and the tests whose expectations moved (backbone-ui, smoke, takeover-ui).

## Round 2 (review board-r1)

Done when (`tests/board-ui.mjs`; red on a6578b8):

13. One answer in flight per card: two quick clicks post one answer (firstmate card on the Board, Studio option), the card's controls are disabled while it runs, and a late refusal never overwrites a recorded answer; a Studio card already answered with the same choice counts as answered. — "two quick clicks on a Studio option post one answer …", "the firstmate answer went through the board once, after two quick clicks".
14. Today's spend sums today's job costs over every run that ran today, finished ones included; a job is dated by its step, else its node; "—" when no cost is recorded at all. — "row details and subtitle … (R-091 finished today: its $1.00 counts)".
15. An expanded card keeps its note, door tick and refusal across re-renders, keyed by card id until answered; a live update that changes nothing on the Board does not redraw it. — "an expanded card keeps its note and its door tick across a re-render (an scard event)".
16. The one-way confirmation on the Board, for a Studio card and a firstmate card; the firstmate row's round; a firstmate row updating live. — "a one-way Studio card in Needs you …", "a one-way firstmate card in Needs you answers with the door confirmation", "the firstmate label shows its round", "a firstmate row updates live, without a reload".
17. Against the real runtime routes (no mock): a stub-provider run reaches its dispatch card, shows on the Board, is answered inline from Needs you and advances. — "the real run detail carries what the Board reads", "the real card is answered inline from Needs you", "the real run advances past Intake on the Board, live".

## Round 3 (review board-r2): every clause proved through its own code

New assertions (`tests/board-ui.mjs`): "an expanded card keeps its note, tick and refusal when it is mounted again" (closed and reopened, so mountCard runs afresh); "a Studio card already answered with the same choice shows as answered"; "a Studio card's options are disabled while its answer is in flight" and "a firstmate card's controls are disabled while its answer is in flight, and it says Sending…" (the request held by route interception); "a late refusal does not overwrite a recorded answer"; "a live update that changes nothing on the Board does not redraw it"; "a live redraw keeps the open Studio card's own elements (mid-typing, mid-click)"; "no cost recorded at all: today's spend reads —".

The clock: the Board reads one seam (`clock()`, `window.crewClock` when set) for "today" and elapsed. The test pins it and the page's `Date` to noon tomorrow, local time, and builds the fixture from the same instant, so the result never depends on when the suite runs.

Mutation check: each change applied alone, board-ui run, then reverted.

| mutation | where | caught by |
|---|---|---|
| card state not restored | the Studio card view (since round 4: scard.js `opts.state`) | "… when it is mounted again", "… across a re-render (an scard event)" |
| "already answered with the same choice" branch removed | the Studio card view (since round 4: scard.js answer) | "a Studio card already answered with the same choice shows as answered" |
| Studio options not disabled in flight | the Studio card view (since round 4: scard.js render) | "a Studio card's options are disabled while its answer is in flight" |
| firstmate controls not disabled in flight | board.js cardView wrapper | "a firstmate card's controls are disabled while its answer is in flight …" |
| late-refusal guard removed | board.js onCardAnswered | "a late refusal does not overwrite a recorded answer" |
| unchanged live update redraws | board.js soft wrapper | "a live update that changes nothing on the Board does not redraw it" |
| open card rebuilt on a live redraw | board.js needRow | "a live redraw keeps the open Studio card's own elements (mid-typing, mid-click)" |
| spend over in-flight runs only | board.js counts | "row details and subtitle …" |
| job not dated by its node | board.js spendToday | "row details and subtitle …" |
| "$0.00" instead of "—" with no cost | board.js counts | "no cost recorded at all: today's spend reads —" |
| page clock not pinned | board-ui.mjs open() | "row details and subtitle …", "a Needs you row shows … its age" |

Not caught alone, by design: the `inFlight` early return in takeover.js confirmSend. While an answer runs the controls are disabled, so a second click never reaches it. The return is defence in depth. Removing both the return and the disabling makes the "went through the board once, after two quick clicks" check fail.

## Round 4 (landing after intent-merge-card)

Needs you mounts the shared card component (public/scard.js, `window.crewCard.mountCard`) for Studio cards; the Board's own Studio card shell is gone. Two additions to the component, through its options and its own guard, serve every host:

- `opts.state`: the host's per-card state object (ticks, note, door tick, refusal, answer in flight). The Board keeps it by card id until the card is answered.
- One answer in flight per card. A card already answered with the same choice shows as answered.

The firstmate card stays the Inbox's card view, with the in-flight guard (takeover.js) and the late-refusal guard (board.js).

New assertions: "a live redraw keeps the open firstmate card's own elements"; "the open Studio card stays one mounted component across the Board's own redraws". The two-click check now counts every answer to SC-201, the second one included.

The mutation check, run again after the rebase. Each change was applied alone, board-ui was run, and the change was reverted.

| mutation | where | caught by |
|---|---|---|
| no host state (`opts.state` ignored) | scard.js mountCard | "… when it is mounted again", "… across a re-render (an scard event)" |
| "already answered with the same choice" removed | scard.js answer | "a Studio card already answered with the same choice shows as answered …" |
| options not disabled in flight | scard.js render | "a Studio card's options are disabled while its answer is in flight" |
| in-flight return and disabling both removed | scard.js | the above and "two quick clicks on a Studio option post one answer …" |
| firstmate controls not disabled in flight | board.js cardView wrapper | "a firstmate card's controls are disabled while its answer is in flight …" |
| late-refusal guard removed | board.js onCardAnswered | "a late refusal does not overwrite a recorded answer" |
| unchanged live update redraws | board.js soft wrapper | "a live update that changes nothing on the Board does not redraw it" |
| firstmate card rebuilt on a live redraw | board.js needRow | "a live redraw keeps the open firstmate card's own elements" |
| Studio component remounted on the Board's own redraw | board.js needRow | "the open Studio card stays one mounted component across the Board's own redraws" |
| spend over in-flight runs only / job not dated by its node / "$0.00" with no cost / page clock not pinned | board.js, board-ui.mjs | as in round 3 |

## Round 5 (follow-ups after the round 4 approval)

18. A decision that is no longer open leaves nothing behind on the Board. That covers a card answered here or elsewhere, a cancelled card, and a card whose run ended. Its open flag, its Studio card state and its mounted card go. The open card list (`/api/scards?open=1`) and firstmate's pending list decide this (board.js `prune`). — "a Studio card answered elsewhere leaves Needs you and the Board drops its open flag, state and mounted card", "a Studio card cancelled elsewhere leaves Needs you …". Red on efbbc99: the entries stayed. Firstmate side (follow-up 11 of r5): "a firstmate decision that leaves firstmate's pending list elsewhere leaves Needs you and the Board drops its open flag and mounted card". A guard: green on 92642da, where prune already reads `S.pending`; red under a mutation where prune keeps ids that are not Studio cards.

This doc was also swept for code and assertion names that rounds 4 and 5 removed or renamed.
