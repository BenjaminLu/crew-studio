# Fix round 1, code-firstmate-smoke (smoke r1 REJECT)

Answers smoke r1 #1–#5. Done when (lines 2 and 3 are red on the base; lines 4 and 5 tighten assertions that were already green there, so they are not fail-first; corrected in fix-record-smoke-r2):

1. #1 Temporary trees are swept only when marked and their run is not live: folded into unit fix-worktrees-r1 (`tests/worktrees.ts` "a marked temporary tree of a dead run is swept; a live run's stays; an unmarked one is left alone").
2. #2 A round reads none of the user's secret folders, proved by reads from inside a round (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, `~/.docker`, `~/.kube`, `~/.npmrc`, `~/.git-credentials`, `~/.codex`, `~/.claude`); `~/.claude.json` joins the denied list. — `tests/round-sandbox.ts` "a round reads none of the user's secret folders …".
3. #3 An answer to a card its node is still raising waits on a readiness promise (resolved when the node starts waiting on the card, or fails), never polls; past `cardReadyMs` (30 s) it is refused with a clear error and the card stays open. — `tests/card-ready.ts` (4 lines).
4. #4 Each round's hand-back commit is asserted on its own: round 1's and round 2's, each with run, node, round and agent trailers. — `tests/smoke-code.ts` "each round handed back its own commit …".
5. #5 The always-true filter is gone; superseded steps (earlier visits of a node that ran again) count in the order, and the test says which they are. — `tests/smoke-code.ts` "the superseded steps are exactly the earlier visits …".
