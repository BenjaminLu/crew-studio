# Fix round 1, class contract: the runtime keeps the contract it claims (runtime brief item 1)

Answers: check-runtime#1 (SSE not wired, no loop runner, card STE with a check that did not exist; Doctor sandbox landed in fix-runtime-sandbox), #2 (a verdict outside the contract), #9 (a quorum of one). It also lands the refine loop runner (the `loop` kind) that the unit claimed.

Done when (each line is proved by `tests/fidelity.ts` or `tests/refine.ts`; both are new and red on the base):

1. The verdict set is exactly pass|fail|warn|error: "skip" is an error and a blocking check that answers it blocks; an adapter whose command the repository does not declare is an error and blocks. — fidelity: "a verdict outside pass|fail|warn|error is error", "a blocking check that answers skip …", "an adapter whose command is not declared …".
2. A judged check blocks only with a quorum of n ≥ 2 failing votes out of of ≥ n independent runs. — fidelity: "a quorum is n ≥ 2 votes of ≥ n runs", "a judged check with 1 of 2 never blocks; with 2 of 3 …".
3. Every node kind of §3.1 has a runner, `loop` included, and a graph whose kind has no runner is refused at save and at start. — fidelity: "every node kind of §3.1 has a runner …", "a graph whose kind has no runner is refused".
4. The engine is wired into the server: a run's transitions reach the browser over SSE (`/api/stream`, event `wrun`); the captain opens an authorization window at `/api/policies/auth-window` (desktop only), and a policy patch cannot. — fidelity: "a run's transitions reach the browser over SSE …", "the captain opens a window in Studio; a policy patch cannot".
5. Every card is STE-checked by `core/ste-wording` (or the checks the workflow names in `card_checks`), the result is on the card, and a zh-TW section that is not Chinese is flagged. — fidelity: "a card is STE-checked by core/ste-wording …", "a zh-TW section that is not Chinese is flagged".
6. The loop runner: produce → checks → brief → produce; a failing check is fixed by the next round with no card; the same class twice raises the step-back card; no score progress for 2 rounds raises a card; the round cap raises the round-budget card and extending it is a run override set by the card; a report-only failure re-runs only the report; a timeout is never report-only; the brief is the fixed template, must pass `core/brief-quality`, and is bound to its round and head. — refine: every line of `tests/refine.ts`.

Note for architecture §3.1: the entry is the one node no edge reaches, so a workflow whose first producer is re-entered by a loop starts with an entry hook.
