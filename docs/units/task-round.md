# Unit task-round: Task and Round

What: one set of words for Studio's work, and a list of the Rounds inside each piece of work.

Words (captain, 2026-10-14):
- Workflow: the template (code-firstmate).
- Task: one piece of work going through a workflow once. It was called "run". Task ids keep their R-NNN form.
- Round: one launch of an agent or a check inside a Task (build round 2, review round 3), and a card the captain answers on the way.
- In zh-TW: 任務 and 回合.

- The UI, API, docs and architecture.md say Task where they said run, and Round where they said a node visit or a step of an agent or a check. Old URLs (#/runs/…) and API paths (/api/wruns…) keep working as aliases. Stored data is not migrated: Rounds are derived from a run's steps (its node visits) when they are read.
- A Task page lists its Rounds in order: which node, which agent or check, round number, attempt, started, ended, outcome, cost, and a link to its transcript.
- `/api/tasks` serves Tasks and Rounds: `GET /api/tasks` (every Task with a one-word status and its Round count, and the open cards), `GET /api/tasks/<id>` (the run view plus `task` and `rounds`), `GET /api/tasks/<id>/rounds`. Every other run route answers under both names (`POST /api/tasks` starts a Task as `POST /api/wruns` does).

Not in this unit (captain, 2026-10-14): firstmate's v1 tasks are not migrated or projected into Studio. A Blocked state for a Task waiting on an infrastructure error or a dependency is left out: the runtime has no dependency between Tasks and does not tell an infrastructure error from any other error, so the state would be a guess.

Why: the captain read "run" as one agent launch, but in Studio it meant one piece of work going through a workflow, and a Task page did not show what each agent and check launch did.

Done when (`tests/task-round.ts`, `tests/task-round-ui.mjs`; red on base):
1. The UI says Task and Round everywhere (a text sweep of public/ finds no user-facing "run" for a Task), in en and zh-TW (任務, 回合); old #/runs and /api/wruns URLs still answer.
2. A Task's Rounds list node, actor, number, times, outcome, cost and transcript: in the API (`tests/task-round.ts`) and on the Task page (`tests/task-round-ui.mjs`).
3. Pages at 1440 and 390, light and dark, no sideways scroll; fresh-context designer review.

Phases: A (the Round model, `/api/tasks`, `tests/task-round.ts`; no UI change) lands first. B (the rename across public/, docs and architecture.md, the Rounds list on the Task page, the UI test) waits for the units in flight on the same UI files.

Phase B implementation scope includes the recent-ended Board links' normal, hover and keyboard focus styles. The global space for the firstmate floating button lives once in `public/styles.css`, shared by Tasks and Skills. Neither follow-up changes stored data or permissions.
