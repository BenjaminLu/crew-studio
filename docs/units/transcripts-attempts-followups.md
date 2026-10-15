# Unit transcripts-attempts-followups: tests for every stale-response guard; the phone setting's error state

What and why (transcripts-attempts r3 follow-ups #5 and #6):
- #5: the sequence guards added in transcripts-attempts r2 (the live crew list, the crew
  report modal, the node-run list, the Firstmate history and its "Newest", the phone
  setting) had no tests. Each guard family now has a stale-response test: the server
  answers, the answer is held back, a newer request is asked and answered, then the held
  answer is let go; the view must keep the newer answer.
- #6: the phone setting set `TR.phoneRaw = null` before reading it and never reset it on a
  failure, so one failed read left the switch showing "off". Now a failed read shows an
  error with a Retry button and keeps the switch disabled (its value is unknown, never a
  silent "off"); a failed change puts the switch back to its previous value and shows the
  error.

Test pages open Studio's session first (`/session?t=…`, what `crew-studio open` does),
because a plain page load is read-only since master's session change; before that, the
phone setting's POST from the test page was refused and its stale test proved nothing.

Done when (`tests/transcripts-ui.mjs`):
1. "a slow older crew list never replaces a newer one".
2. "the report modal shows the report asked for last".
3. "a slow first node-run list never replaces the second".
4. "an older history page never joins the history that "Newest" started".
5. "the phone setting shows the answer to the last change, as the server holds it".
6. "a failed read of the phone setting shows an error, not "off"", "a failed change restores
   the previous value and shows the error".

Fail-first (run on `073801f`, the merge of transcripts-attempts; the branch was then rebased onto `7f8fada`, its merge-base now):
- Lines 1–5 test guards that already exist, so they pass on the base. To show they are not
  vacuous, each was run with its guard removed (the `seq` check in `loadCrewLive`,
  `openReport`, `loadNodes`, the phone setting's change handler, and the history join
  condition): all five failed, and all five pass with the guards in place.
- Line 6 is a behaviour change: on the base both assertions fail (122 passed, 2 failed).
