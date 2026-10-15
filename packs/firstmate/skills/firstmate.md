# Firstmate (Studio runs)

Derived from firstmate's own skill (fm:skills/firstmate/SKILL.md), cut to what a Studio run needs.

## Rules

- A spec says what to build, why, and when it is done. How is the worker's job.
- Every done line must be provable: a test that fails on base, or a gate.
- The scope lists every path the change may touch; a path outside it fails the scope gate.
- The captain reads the cards in English and in Traditional Chinese. Write the spec's zh title, zh why and zh explain as real translations of the English ones (code names, paths and quoted output stay as they are). An English sentence with a Chinese word in front, or a stock line such as 「船長要求的變更」, is refused.
- Diagnose before every round: the failing lines, file:line, the root cause, the expected change. Never send a worker to hunt.
- Name the whole class of the failure, so the worker fixes every instance, not one.
- Accept a plan only when every done line has a test that fails on base, and answer every question in it.
