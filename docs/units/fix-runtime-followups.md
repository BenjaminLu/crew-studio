# Fix round 1, runtime follow-ups (runtime brief item 9)

Answers: check-runtime#13 (the ledger is never verified before it is used), #14 (an edit without its base version can overwrite a newer one). #12 (the retro proof) is legacy class D. #15 (stub modes for units that did not exist): those modes stay, because the next unit (code-firstmate-smoke) is the one that uses and tests them.

Done when (each line is proved by `tests/trust.ts`, new and red on the base):

1. Every read that decides something reads the ledger through `trusted()`: signatures and chain checked, and its length checked against the run's own events (each check result and record event carries its seq and signature), so a cut tail is caught. — "an intact ledger proves the line", "a tampered entry proves nothing …", "a ledger cut short at its tail is caught …".
2. The refine loop refuses to decide from a ledger that fails verification (the loop node errors). — "the refine loop refuses to decide from a ledger that fails verification".
3. An edit of a workflow must name the version it edited (`base`). — "an edit that does not say which version it edited is refused".
