# Tracked: github-review stays held (retro 2026-10-17, finding 22)

Status: open.

github-review cannot run: its runtime is not activated, and its graph has drifted from code-firstmate (it has no design-scope or designer round, for one). It stays held: kept and editable, absent from the Start form, and the board refuses a new Task with the held reason.

It is not part of the end-to-end set. The catalog's held reason and docs/units/github-review-workflow.md say so; tests/acceptance/github-review.yaml only proves it stays held. GitHub pull requests run through code-firstmate on a GitHub project.

Since this retro it is staffed by kind like every code workflow (finding 21), so an activated version cannot start without approved roles.

Close this note when github-review is rebuilt from code-firstmate (its graph derived from code-firstmate's, plus the external-review wait), passes code-firstmate's acceptance scenarios, and has its own live end-to-end run recorded in a retro.
