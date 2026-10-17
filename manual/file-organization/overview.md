# file-organization

## Briefing

- Tidies one folder the captain names (an absolute path, the `folder` parameter): a dry-run plan, the pack's gates,
  the captain's card, then the moves.

## Environment

- Runs inside Studio on the named folder only. Every move stays inside it; nothing is overwritten.

## Tools

- None for a model: the plan is deterministic.

## Tests

- `file-organization/plan-gates`: moves stay inside the folder, no overwrite, the move cap. A failing gate discards
  the plan.

## Dependencies

- None.

## Deliverable

- The applied moves, with a write-ahead undo log the captain can replay from the Task.
