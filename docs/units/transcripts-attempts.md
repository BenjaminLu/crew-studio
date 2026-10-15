# Unit transcripts-attempts: every attempt and hand-off of a node round

What: a node round's record holds one invocation per attempt and per hand-off
(`prompt.md`, `prompt.attempt<k>.md`, `prompt.hop<n>.md`, `prompt.attempt<k>.hop<n>.md`,
with `system<sfx>.md` beside each; see `roundRecord` in src/agent.ts). The Runs viewer lists
them all in order (attempt, then hop), and each has its own Prompt, Transcript and Report.
The live view follows the newest invocation.

Why: retries became invisible: the viewer only knew `prompt(.hop<n>)?.md`.

How:
- `GET /api/node-runs/<run>/<node>/<round>[?prompt=<name>]` returns `invocations`
  (`{name, attempt, hop}`, sorted), `newest`, and the chosen invocation (the newest by
  default): its prompt, its `system<sfx>.md`, and its report.
- Report: `report<sfx>.json` when it exists; else `report.json` when its `prompt` field names
  this invocation (a `report.json` without one belongs to `prompt.md`); else none.
- Transcript (`/transcript?prompt=<name>&after=<cursor>`): `stream<sfx>.jsonl` when it
  exists (cursor: a byte offset); else this invocation's segment of the shared
  `stream.jsonl`, from its `status: started` entry (whose `prompt` names it) to the next one.
  The shared stream is read incrementally: the cursor is `<byte offset>|<the invocation that
  owns the stream there>`, each read takes at most 16 MiB of complete lines, and `size` is
  in bytes. The response names `newest`.
- Live comes from the engine, not from files: the round is live while `run.json` says the run
  is active and its node is running this round (`visits` = round) or is pending and queued to
  retry it (`visits` + 1 = round). That covers the gap the runtime always leaves between one
  attempt's end (terminal status, `report.json`) and the next attempt's prompt, and between a
  hand-off's report and its next hop. The page polls while the round is live.
- A phone's node view carries `invocations` and `promptName` (never the prompt or report
  body), so the invocation bar and following work there too.
- UI (`#/runs/node/<run>/<node>/<round>[/<prompt name>]`): an invocation bar above the tabs;
  the newest is selected and followed: when a poll names a newer invocation, the view moves
  to it and starts its transcript at 0. Picking an older one stops following.

Done when (`tests/transcripts-attempts.ts`, new; fixture `R-4`: attempts 1 and 2 and a
hand-off in attempt 2 with one shared stream; `R-5`: per-attempt stream and report files):

1. "a node round lists every attempt and hop in order", "each invocation names its attempt
   and hop", "the newest invocation opens by default".
2. "an older attempt shows its own prompt and system prompt, and no report it did not
   write", "each invocation has its own transcript", "the report belongs to the invocation
   that wrote it", "per-attempt stream and report files are read when they exist".
3. "an unknown or malformed invocation is refused".
4. Live and follow, on the runtime's real sequence (an attempt ends with a terminal status
   and `report.json`, the engine queues the retry, then the next prompt appears): "a node
   round is live while the engine runs its node", "in the gap between one attempt's end and
   the next attempt's prompt, the round is still live", "a poll of an older invocation names
   the newer one to follow", "the new attempt's transcript starts at its own start", "a poll
   returns only what was appended after its cursor", "a round whose node has moved to a
   later visit is not live", "a round whose node or run ended is not live".
5. UI (`tests/transcripts-ui.mjs`): "the node view lists every attempt and hop, newest
   selected", "an older attempt shows its own prompt", "an older attempt shows its own
   transcript", "picking an older attempt stops following", "the newest hand-off shows its
   own transcript", "the live view follows a new attempt without a reload" (with a poll in
   the gap between attempts), and "node-attempts renders / has no sideways scroll" at 1440
   and 390 px in light and dark.
6. "a long stream is read in capped slices, and its size is in bytes", "the next poll
   continues from the cursor to the end".
7. Phones: "the phone's node view names the invocation it shows"; UI "phone-node renders /
   has no sideways scroll" at 1440 and 390 px in light and dark (a phone paired over LAN).
8. A response applies only to the view it was asked for (review round 2). Every request in
   the round detail carries a generation (`TR.gen`, changed by a new round, a switch of
   invocation, or a follow); a response under another generation is dropped, and only the
   current generation schedules the next poll. The same class is closed elsewhere with a
   sequence number: the round report, the phone setting, the Firstmate history pages ("Newest"
   starts a new one), the node-run list, the live crew list, a crew report modal, and the
   one-way door check (any change of the selection, even one that makes it incomplete,
   supersedes an older check). UI: "a poll in flight for one invocation never lands in
   another (entries and cursor untouched)" (`tests/transcripts-ui.mjs`), "a slow check of an
   older answer never overrides the newer answer" (`tests/takeover-ui.mjs`).

Fail-first, on the first base `c0edb8c` with only the new tests copied in (the branch was later rebased onto `4d1d8a1`, [unit:fix-migrate-stream], its merge-base now):
`tests/transcripts-attempts.ts` 0 passed, 11 failed (one invocation listed; every
transcript held all three segments; per-attempt files ignored; the round not live while an
older attempt's report.json existed). `tests/transcripts-ui.mjs` stopped at the R-1 node
view: no invocation bar (TimeoutError).

Changed tests: `tests/transcripts.ts` asks for `?prompt=prompt.md` on R-1, because a round
now opens on its newest invocation (R-1's newest is `prompt.hop2.md`); `tests/transcripts-ui.mjs`
selects `prompt.md` on R-1 the same way. The guards they hold are unchanged.

Review round 1 (REJECT on `e05e164`; tests rewritten first to the runtime's real sequence and
run on `e05e164`): `tests/transcripts-attempts.ts` 13 passed, 5 failed ("in the gap … still
live", "… moved to a later visit is not live", both 16 MiB cursor lines, "the phone's node
view names the invocation it shows"); `tests/transcripts-ui.mjs` 111 passed, 5 failed ("the
live view follows a new attempt without a reload", and phone-node in all four
width/scheme cells). "picking an older attempt stops following" was green there: it adds a
test to behaviour that already worked.

Review round 2 (REJECT on `70f3372`): both new UI tests were written first and run on
`70f3372`: "a poll in flight for one invocation never lands in another" failed (attempt 1's
entries appeared under attempt 2), and "a slow check of an older answer never overrides the
newer answer" failed (the older answer's refusal re-locked the merge).
