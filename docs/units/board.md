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

## Round 6: task overview (captain-approved redesign)

Why: Needs you repeated the Inbox's cards in full, every workflow drew a full graph ("Live workflows") so several parallel Tasks tangled into one picture, and the task table sat at the bottom of the page. The approved prototype (Main.dc.html at 1440, Phone.dc.html at 390) replaces all three sections with one task overview. Needs you, Live workflows (public/workflow-overview.js, removed), Ended and Crew on duty are gone; the subtitle keeps the counts and today's spend.

What the Board shows:

- **Filter tabs** with counts: All, Waiting for you, Running, Stuck, Done today (全部 / 等你 / 進行中 / 卡住 / 今天完成).
- **One row per Task**, Studio runs and firstmate tasks alike, ordered Waiting for you, Stuck, Running, Done today (newest first within a group): status; title with run, workflow and project; the milestone track with the current milestone marked, its round and position ("Build loop · round 2/3 · 4/7"); **Now**; the overlap badge; elapsed.
- **Now**: on a running Task, who works: the node, its crew seat (the node's seat, else its role's; the workflow's own seat label, else the built-in seat names of src/domain/crew.ts) and the provider and model the run resolved (the node's agent, else its latest step). On a waiting Task, "Waiting for you: <card title>" and a "Go to Inbox →" link to `#/inbox/<card>`; the card is the run's oldest open card of the node's current visit (a card from an earlier visit never counts). On a stuck Task, why it is stuck, with a link to its card when it has one (a failure card). On a Task done today, its run state's word (Merged, Done, Closed without merging, Cancelled), in that word's tone.
- **Overlap badge** "↻ will rebase" / "↻ 會 rebase": another open Task's `ctx.spec.scope` meets this one's (one path holds the other, a glob by its static prefix, test paths never count; the same reading as src/runtime/queue.ts scopesOverlap). Its title names the other Tasks.
- **Detail panel** for the selected row, and nothing else: this Task's visited path from its steps (vertical; a revisit reads "round N ↺"; a step retried within one visit is one stop; bookkeeping hooks without a role are left out unless they failed or are current), every current node ringed (parallel branches each ringed; Firstmate when it is deciding an escalation), the four latest events in the Task page's own words (runtime.js `crewTimeline`), and **Full graph** (`#/run/<id>?graph=1`, the Task page scrolls its graph into view) and **Open task**.
- No card body and no workflow graph on the Board. A footnote says so.

Milestones (board.js `milestones(def)`, deterministic per definition):
1. the definition's stages when it has any (`crewLayout.stagesFor`: the nodes' own `stage`, else the built-in grouping, e.g. code-firstmate's seven stages);
2. otherwise its main path: from the entry node (the first with no incoming edge), follow at each node the first outgoing edge to a node not yet on the path, an unconditioned or forward edge (ok, pass, go, approve, accept, merge, done, yes, dispatch, next, continue) before any other, in definition order. The milestones are the path's work nodes: agents, checks, cards, loops, and hooks that run a role. A node off the main path belongs to no milestone; the track marks the milestone after the last one reached.

Groups, from the run's own state:
- **Stuck**: the run failed (a run ended by its round cap fails too, result `cap`); or a node reached its round cap (`outcome: "cap"`) and no node has run since (the cap's own route, a card or an end, is pending); or Firstmate is deciding an escalation first (`ctx.firstmateQuestion`: an agent's question, or a card Firstmate diagnoses before the captain). A firstmate task: `failed`.
- **Waiting for you**: not stuck, and the run has an open card or a node waiting on one. A firstmate task: `needs-you`.
- **Done today**: ended today and not failed (succeeded, closed, cancelled). A firstmate task: merged today.
- **Running**: the rest (queued, running, paused, waiting on an external event).
- Failed runs stay on the Board for a day, as before; archived ones never show.

Layout follows the main column's width (the Firstmate panel takes room from it), re-chosen when that width crosses a threshold: ≥ 1080 px a table with the panel beside it; 640–1080 px compact rows with the panel beside it; < 640 px (a phone) cards with the panel opened under the chosen card (tapping it again folds it) and a top bar "N tasks waiting for you · Go to Inbox →" linking to `#/inbox`. No sideways scroll at any width.

Live: rows follow the page's one stream as before (the same membership and stale-detail rules). A redraw keeps the selected Task, the focused row and the scroll, including the panel's own. Keyboard: ↑/↓ move the selection along the rows (focus follows, the panel follows), Enter opens the Task.

Data: the existing APIs only (`/api/wruns`, `/api/wruns/<id>`, `/api/scards?open=1`, `/api/policies`, firstmate's summary). No server endpoint was added.

Tests:
- tests/board-overview-ui.mjs (new): 1440 with the Firstmate panel closed (table) and open (compact list, panel beside), and 390 in zh-TW (cards). No card body, no workflow graph, row order and groups, every filter with its count, the milestone track and label, Now (seat and model; the card and its Inbox link; why stuck), the overlap badge, the detail path with "round 2 ↺" and the current node ringed, Firstmate ringed on an escalation, recent events, Full graph and Open task, ↑/↓ and Enter, a live update keeping the selection, focus and scroll, the Inbox deep link, the phone bar, the main-path milestone rule, no sideways scroll. Screenshots in tests/out/board-overview (or `BOARD_SHOTS`).
- tests/board-ui.mjs: the parallel runs and their milestone states, labels, subtitle and spend, live updates and one stream, and the waiting decisions' links. The answering checks that ran in Needs you (refusal inline, one answer in flight, the door tick, note and tick kept across a re-render, a late refusal, the firstmate door confirmation, answers through the board) now run in the Inbox, where the cards are answered. The Board's per-card state checks (`crewBoard.held`) went with the code they tested.
- tests/workflow-overview-ui.mjs, -races.mjs, -fold-ui.mjs: ported from the graph to the rows on the real engine. They cover card identity per Task, a stale-visit card, failure cards, parallel waits ringed, done today, archive/unarchive/delete live, stale details that cannot bring back a left card, the first viewport, a live move with the viewer's scroll and selection kept, storage blocked, and the live cue captures.
- run-end-ui, smoke, inbox-live-ui, studio-agents-ui, task-round-ui, crew-visibility-ui: their selectors follow the new rows.
