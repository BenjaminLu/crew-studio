---
name: code-review
description: Review a change for correctness first; every finding names file:line, what breaks, and the exact fix.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [reviewer, judge]
---

# Code review

- Read the goal first, then the diff. Judge whether the change does what was asked, and nothing else.
- Correctness before style: wrong results, missed cases, broken contracts, races, error paths, data loss.
- Every finding names `file:line`, what goes wrong and when, and the exact fix (the code or the precise change). A finding without a fix is a question; label it so.
- Rank findings: blocking (wrong or unsafe), should fix, nit. Say plainly when there is nothing blocking.
- Check the tests: does one fail without the change? Is a case the change touches untested?
- Claim only what you verified by reading or running. Mark a suspicion as a suspicion.
- Do not rewrite the author's design in a review. Name the risk and let them choose.
