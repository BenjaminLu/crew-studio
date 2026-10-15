# Fix round 1, class tests: the runtime's tests prove contents (runtime brief item 8)

Answers: check-runtime#10 (truthiness for zh-TW; untested project and run-override levels; the `hang` and `refine` flows never started). The `ok(true)` off macOS went in fix-runtime-sandbox.

Done when (each line is a `tests/runtime.ts` assertion that is red on the base):

1. A card carries its sections in en and in zh-TW, and the zh-TW title and text are Chinese (a workflow's card text may carry both locales). — "a card carries its intent sections in en and in zh-TW (actually Chinese) …".
2. Policy levels resolve in order: org (7) → project (8) → workflow version (9, existing assertion) → a card's run override, which adds (8 + 5 = 13). — "params: a project's policy beats org …", "params: a card's run override adds to what resolved …".
3. A node killed at its time limit ends `failed(cause=timeout)`, keeps its work, and the loop takes it from there. — "a node killed at its time limit ends failed(cause=timeout) …".
4. The refine flow runs end to end through its stop conditions in `tests/refine.ts` (fix-runtime-contract); the unused copy in `tests/runtime.ts` is gone.
