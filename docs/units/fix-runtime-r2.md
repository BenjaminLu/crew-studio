# Fix round 2, runtime (check-runtime r2 REJECT)

Answers check-runtime r2 #7, #16, #17 (must-fix) and #18, #19 (follow-ups). #12 and #15 stay deferred (legacy D; the smoke unit uses the stub modes).

Done when (each line names the test that proves it; every test is red on the base):

1. #7 A card's door comes from the workflow, never from an option id: a card node names where its door is (`door_from`, the door node's stored output) and the card carries `door`. On a one-way door every option that is not marked `hold` needs the door confirmation, whatever its id; the runtime holds no option or door literal. — `tests/generic.ts` "a card declares its door from the door node's output …", "a hold option needs no confirmation", and the literal sweep (now also `choice === "…"`, `=== "merge|dispatch|close|approve"`, `ctx.door`); `tests/authority.ts`, `tests/runtime.ts` card flow.
2. #16 One middleware (legacy A5) in front of every non-GET route: same site (Origin, when sent, is Studio's; Sec-Fetch-Site, when sent, is same-origin or none), a Studio session (the HttpOnly SameSite=Strict `crew_session` cookie the page gets, or `x-crew-session` from `data/session-token`, mode 0600) or a paired device's token, and a JSON body. The agent tool route keeps its per-job token, pairing keeps its code and an Origin check. Opening an authorization window also needs a fresh confirmation the UI asks for (`/api/policies/auth-window/confirm` nonce, single use). — `tests/write-guard.ts` reads every route from the router's source (95 today) and proves each refuses cross-site, no session and a non-JSON body; `tests/fidelity.ts` grant confirm and reuse.
3. #17 A check sandbox reads only what the runtime materialized for it (the artifact, its previous version, the worktree, out/, tmp), realpath-checked; never a protected root or data/. A param that names a path is never widened into a read. — `tests/sandbox.ts` "escape" fixture with a param path probe.
4. #18 A card answer and its ledger record are one durable step: the record is written when the answer is carried into the run, once, and a restart between the two writes it then. — `tests/durability.ts` "the card answer is recorded once".
5. #19 Tests act on nothing host-wide: fixtures write their own pids, process checks look only at those pids, temp dirs and injected deps only. — `tests/sandbox.ts`, `tests/lifetime.ts`.

Every test client sends `x-crew-session` (CREW_SESSION_TOKEN), including `tests/takeover-ui.mjs` (a one-line edit in the takeover area).
