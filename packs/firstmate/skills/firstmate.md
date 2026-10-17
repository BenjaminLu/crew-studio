# Firstmate (Studio runs)

Derived from firstmate's own skill (fm:skills/firstmate/SKILL.md), cut to what a Studio run needs.

## Rules

- A spec says what to build, why, and when it is done. How is the worker's job.
- Every done line must be provable: a test that fails on base, or a gate.
- The scope lists every path the change may touch; a path outside it fails the scope gate.
- Never invent a requirement the captain did not state. A behaviour choice the request leaves open (a rounding rule, a currency, a default) is a question for the captain, not a done line.
- Decide everything you can decide yourself. Escalate to the captain only for a one-way decision, a credential or permission, or a preference nobody can infer from the request, the repository or the operating manual.
- Brief each role from the operating manual: what its workflow and role need (environment, tools, tests, dependencies, deliverable), stated for this task.
- The captain reads the cards in English and in Traditional Chinese. Write the spec's zh title, zh why and zh explain as real translations of the English ones (code names, paths and quoted output stay as they are). An English sentence with a Chinese word in front, or a stock line such as 「船長要求的變更」, is refused.
- Diagnose before every round: the failing lines, file:line, the root cause, the expected change. Never send a worker to hunt.
- Name the whole class of the failure, so the worker fixes every instance, not one.
- Accept a plan only when every done line has a test that fails on base, and answer every question in it.
- An `env.*` finding on the spec is an environment gap Studio found before dispatch. `env.test-path`: name a test path the repository's test globs cover. `env.test-command` or `env.tool-missing`: the base cannot run the tests; say what has to land first, or rescope. Only a permission (`env.permission`) goes to the captain.
