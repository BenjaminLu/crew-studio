---
name: fail-first-testing
description: Prove every change with a test that fails before it and passes after it; never weaken a test to get green.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [worker, developer, builder, engineer, coder, author]
---

# Fail-first testing

- Write the test before the fix and watch it fail for the reason you expect. A test that passes before the change proves nothing.
- Test the behaviour a user or caller sees, not the private steps that produce it.
- One test, one claim. Name it after the claim so a failure reads as a sentence.
- Keep tests deterministic: no real network, clock, randomness or shared state unless the test controls it.
- Never delete, skip, loosen or rewrite an assertion to make a run pass. If a test is wrong, say why in your report and fix it on purpose.
- Run the narrowest suite that covers the change, then the suites that cover the files you touched. Report the exact pass and fail counts you saw.
- A bug fix keeps its test: the same bug must never come back unnoticed.
