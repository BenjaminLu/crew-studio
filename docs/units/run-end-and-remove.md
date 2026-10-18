# How a run ends, and removing runs

The captain abandoned R-002 at its merge card. The run then followed the workflow's
"closed" end node, so it shows `succeeded` with result `closed`, as if the flow finished.
R-001 failed and cannot be removed from the lists. A run the captain gives up on must read
as given up, and an ended run must be removable.

What:
- Run states the captain sees use one word each: Running, Waiting for you, Merged, Done,
  Closed without merging, Cancelled, Failed. `succeeded` with result `closed` shows as
  "Closed without merging" (neutral colour, never the success green). Runs, the Board
  (home) and the run page use the same words in en and zh-TW.
- A code Task that ended closed or cancelled although its pull request was merged on GitHub
  (an older release closed it) reads "Merged (reconciled)" / 已合併（事後核對）. Studio reads the
  pull request again, read-only with the project's grant, on boot and from the run page's
  "Check GitHub for a merge"; a merge into the Task's base becomes one signed
  `reconciled-merge` ledger entry (pull request, merge commit, when observed, the original end).
  Earlier entries and the recorded end stay as they were; nothing is done on GitHub. The grant
  passes the same gate as every other GitHub use (enabled project, signed grant) or nothing is
  read. A merge of another head than the one Studio verified reads "Merged (reconciled,
  unverified head)" in the warning colour and names both heads.
- Cancel works from any non-ended state, including a run waiting at a card. Cancelling
  withdraws its open cards (they leave the Inbox and the Board's Needs you), stops its agents
  and runs its `on_cancel` hooks. The run ends `cancelled` with the captain's optional reason.
- An ended run (merged, done, closed, cancelled, failed) can be archived or deleted.
  - Archive hides it from the default lists; a "Show archived" filter brings it back, and
    unarchive restores it.
  - Delete is permanent. The captain types the run id to confirm. It removes the run's
    directory, its worktree and branch in the sandbox repo (never a commit already merged into
    the repo's main), its cards and its captures. The evidence ledger keeps its signed
    entries and gains one entry recording the deletion (who, when, run id), so the ledger
    stays verifiable.
  - A live run (queued, running, waiting, paused) cannot be archived or deleted; the server
    refuses it.
- Both actions are the captain's act (session cookie plus Origin) and are recorded as events.

Why: a list full of dead runs hides the live ones, and a given-up run that shows as a
success misreports what happened.

Done when (`tests/run-end.ts`, `tests/run-end-ui.mjs`; red on the base):
1. A run whose merge card is answered "close without merging" shows "Closed without merging"
   on Runs, the Board (home) and the run page, in en and zh-TW, and never the success style.
2. Cancel on a run waiting at a card withdraws the card from Inbox and Needs you, ends the run
   `cancelled` with the reason, and runs `on_cancel`.
3. Archive hides a failed run from the default lists; "Show archived" shows it; unarchive
   restores it.
4. Delete with the typed id removes the run directory, worktree, branch, cards and captures;
   the ledger verifies afterwards and has one deletion entry. A wrong typed id is refused.
5. The server refuses archive and delete for a live run, and refuses both without a session
   or with a foreign Origin.
6. Delete never removes a commit already merged into the sandbox repo's main.
7. Runs page and run page at 1440 and 390, light and dark, no sideways scroll; fresh-context
   designer review page by page.
8. Delete and archive are refused (409 "still finishing: …") while work that holds the run is still
   in flight: its on_cancel hooks, a node, a card being raised. Once deleted, nothing writes into the
   run: the deletion entry stays the ledger's last, the run folder stays gone, no unhandled rejection.
   A domain clean-up (onDelete) that throws leaves the run intact and writable, and the error goes back.
