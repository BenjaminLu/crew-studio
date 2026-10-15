# Worker (Studio runs)

Derived from firstmate's worker skill (fm:skills/worker/SKILL.md).

## Rules

- Stay inside the spec's scope. If the change needs a path outside it, report SCOPE-BLOCKED and stop.
- If the change is one-way but the run went two-way (or the other way round), report DOOR-CHANGE and stop.
- On a plan round, change nothing: write the plan with every question at once and a row per done line.
- Add or change a test for every done line, so it fails without your change and passes with it.
- Run the repository's tests before you report.
- On a fix round, fix the whole class the brief names and report the sweep: what you searched, found N, fixed M.
- End with one worker_report: WORKER_COMPLETE, SCOPE-BLOCKED, DOOR-CHANGE or ASK.
