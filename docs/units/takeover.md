# Unit takeover: session takeover (architecture §7)

## What

Studio becomes the captain's single entry point to the firstmate session. It forks the
firstmate Claude Code session and drives the copy, shows every crew round live, brings
permission prompts and questions to the captain, and renders firstmate's cards in full,
forwarding answers to the v1 board.

## Why

The captain wants one place to dispatch work, watch the crew, answer prompts and answer
intent-alignment cards, without losing the terminal session or driving it twice.

## How it works (the parts that change a decision)

- **Fork only.** Take over runs `claude -p --resume <id> --fork-session` with the session's
  own cwd, model and permission mode (read from its transcript), and
  `--permission-prompt-tool` pointing at Studio's permission bridge. The original id is
  never resumed or written. The project's hooks and MCP config load as in the terminal,
  because the CLI runs in the same cwd.
- **Rehearsal** is the same fork with `FM_IN_ROUND=1`, so firstmate's own hooks stand down
  in the copy (its watch never claims the live session's wakes), and wakes are shown and
  held, never sent.
- **Wakes.** firstmate pushes every wake to `state/session/wake.jsonl`. In a takeover the
  copy's own Stop hook (`fm-watch-arm.sh --hook claude`, asyncRewake) claims it and wakes
  the copy; `claude -p` in stream-json mode runs that as a turn of its own, which Studio
  follows. Studio also reads the queue (read only): each wake shows in the chat stream as
  a system line and waits in the input queue. When firstmate's acknowledgement record
  (`state/session/acknowledged/<id>.json`) shows the hook delivered it, it leaves the
  queue; if not, Studio sends it after a grace period (`CREW_WAKE_GRACE_MS`, 10 s).
  While the terminal session is still open, its own parked Stop hook competes for the same
  wakes, which is why the terminal must be exited after takeover.
- **Turns Studio did not send** (a hook wake, or a background task's notice inherited from
  the original) are followed: Studio marks the session busy, streams them, and resumes its
  queue afterwards.
- **Driver lock and handoff.** `data/driver.json` names the copy, the original and the
  mode; `data/handoff/<time>-<id>.md` (0600; a file, beside the runtime's per-run `data/handoff/<run>/` folders) records the settings, the copy's id, the
  release and both resume commands.
- **Cards** (architecture §3.4): firstmate's cards stay on the v1 board. Studio renders
  every intent section in en and zh-TW and forwards the captain's answer to
  `POST /decisions`. A one-way merge needs every intent reviewed and the check answered;
  Studio asks the board's own `POST /decisions/check-door` and sends the same
  confirmation with the answer. Studio never answers a card by itself.

## Routes

`GET /api/takeover`, `POST /api/main/takeover {id, mode, confirm}`, `POST /api/main/detach`,
`POST /api/main/question {id, answers}`, `POST /api/main/dispatch {text}`,
`POST /api/main/interrupt`, `GET /api/crew/live`, `GET /api/crew/report/<actor>`,
`POST /api/answer/check-door`, `POST /api/answer` (with the door confirmation).
Page: `#/firstmate` (or `#/takeover`); no sidebar entry of its own.

## Done lines

Each names the test that proves it; see "Fail-first" for where each was red.

1. Take over forks with the same model and permission mode, prompts to Studio, never the
   original id: `tests/takeover.ts` "the CLI forks with the same model and permission mode,
   prompts to Studio", "the original transcript is never written", "Studio follows the
   copy's new id", "discover reads the session's model and permission mode".
2. A takeover is allowed while the terminal holds the original, says so, and needs the
   captain's confirmation: "takeover is allowed while the terminal holds the original (it
   forks)", "the view says the terminal still looks open", "a takeover needs the captain's
   explicit confirmation"; UI: `tests/takeover-ui.mjs` "the takeover dialog says the
   terminal session must stay idle", "takeover waits for the captain's tick".
3. Driver lock and handoff note: "the driver lock names the copy, the original and the
   mode", "a handoff note is written in data/handoff and names the copy".
4. Release returns control with a one-line resume command and the rollback: "release
   returns the copy's resume command", "the handoff note gets the release and the
   rollback to the original", "the lock goes back to the terminal"; UI "the resume command
   names the copy".
5. Rehearsal keeps firstmate's hooks out of the copy: "a rehearsal runs with
   FM_IN_ROUND=1 so firstmate's hooks stand down", "a rehearsal never sends a wake";
   a real takeover keeps them: "a real takeover keeps firstmate's hooks (no FM_IN_ROUND)".
6. Wakes reach the queue, deduped, as system lines, and are delivered once: "a synthetic
   wake reaches the queue and shows in the stream as a system line", "the same wake twice
   is one wake", "a wake firstmate's hook delivered leaves the queue", "a wake the hook
   did not deliver is sent by Studio after the grace", "a wake folded into a waiting one is
   not sent before its own grace", "each folded wake is sent exactly once"; UI "a synthetic
   wake reaches the input queue". The grace is measured per wake (each folded wake keeps
   its own arrival time), never on the merged queue item.
7. Turns the session's own hook starts are followed: "a turn the session's own hook
   started is followed and shown".
8. Questions and prompts: "a question the session asks is answered from Studio"; UI "a
   question the session asks shows as a reply box", "the answer goes back to the session".
   Permission allow/deny and interrupt keep their `tests/host.ts` and smoke coverage.
9. Live crew: "the live crew lists each round with task, title, role, vendor, phase,
   elapsed, PR, CI and its report", "a finished round's final report is served", "a report
   path outside the runs is refused"; UI "a crew row shows task and phase", "a running
   round is marked live", "the final report opens from the row", "a round that wrote its result is not live
   even if its old pid is reused" (red before the takeover-liveness commit: a reused pid made a merged
   task's reviewer look live in the real T-306 history).
10. Cards: UI "the card shows its intent/why/scope/done/before-after/how/glossary section",
    "the card shows the walk", "a one-way merge shows the door confirmation", "the merge
    stays locked until the door is confirmed", "a wrong check answer is refused by the
    board's check", "the right answer unlocks the merge", "the answer goes to the board
    with the door confirmation", "the server refuses a one-way merge answer without the
    door confirmation", "the card reads in zh-TW"; `tests/takeover.ts` "the door check is
    forwarded to the board's own check-door", "a door check without every intent reviewed
    never reaches the board", "a door check with only some of the card's intents never
    reaches the board", "a door check with a repeated or unknown intent never reaches the
    board", "door completeness: every intent of the card, each once", "a one-way merge answer
    needs the door confirmation; hold and send-back do not"; UI "a partial or repeated intent
    list is refused and nothing reaches the board". Both `/api/answer/check-door` and
    `/api/answer` require every intent id of the card exactly once before calling the board.
11. Dispatch from chat asks firstmate for a card, not a dispatch: "dispatch from chat asks
    firstmate for a card, not a dispatch"; UI "dispatch sends the intent to firstmate to
    raise a card".
12. Every view at 1440 and 390 px, light and dark, without sideways scroll: UI "<view>
    renders at <width> <scheme>", "<view> has no sideways scroll at <width> <scheme>".
13. A board-only card (a retro) is refused with 409 and nothing reaches the board:
    `tests/smoke.mjs` "the server refuses a board-only (retro) card and sends nothing".
14. Hygiene: `tests/takeover.ts` "the host has no undocumented trace writer and no require()
    in ES modules", "this unit's files carry no machine-specific absolute path". `tests/takeover-ui.mjs`
    finds Playwright through `PLAYWRIGHT_MODULE` or the `playwright` package (other suites: repo-wide sweep).

## Fail-first

Base: the branch is rebased onto master `eb31ab8` ([unit:locators]), which is its
merge-base (`git merge-base takeover master`).

- Round 1 (done lines 1–12): `tests/takeover.ts` and `tests/takeover-ui.mjs` did not exist
  on master. Copied onto master as it was then, `tests/takeover.ts` gave 0 passed, 5 failed
  (no model or permission mode in discovery, no `MainSession.takeover`, no `src/takeover`)
  and `tests/takeover-ui.mjs` failed at "the Take over page lists the firstmate session".
  So those lines are red by construction (the module is missing), not assertion by assertion.
- Round 2 (review REJECT on head `ab995bf`), each test written first and run on `ab995bf`:
  `tests/takeover.ts` 34 passed, 7 failed — "a wake folded into a waiting one is not sent
  before its own grace", "a door check with only some of the card's intents never reaches
  the board", "a door check with a repeated or unknown intent never reaches the board",
  "door completeness: every intent of the card, each once", "the door check is forwarded to
  the board's own check-door" (the partial lists had reached the mock board), "the host has
  no undocumented trace writer and no require() in ES modules", "this unit's files carry no
  machine-specific absolute path"; `tests/takeover-ui.mjs` 58 passed, 1 failed — "a partial
  or repeated intent list is refused and nothing reaches the board".
- Line 13 restores a guard whose test had been dropped; the guard itself already worked, so
  the test is green on `ab995bf`. It goes red when the `card.boardOnly` refusal in
  `src/server.ts` is disabled (checked: 222 passed, 1 failed).
- "each folded wake is sent exactly once" passed on `ab995bf` too: the stub CLI has no hook
  of its own, so the double delivery shows only as the early send that the grace test catches.

## Not covered by automated tests

The real fork and the real asyncRewake turn were checked by hand (see the hand-off report):
a rehearsal fork of the live session answered one question, and a `claude -p` stream-json
process ran a turn started by an asyncRewake Stop hook with no input from Studio.
