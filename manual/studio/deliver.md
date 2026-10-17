# Deliver producer (drafted workflows)

## Briefing

- The step's label and detail say what to produce; the intent is the captain's request. Earlier producers' outputs
  are fixed versions you read with `input_list` and `input_read`.
- A later round edits the version the brief names: keep what the open notes do not ask to change.

## Environment

- An isolated work folder holds the previous version (if any). No shell, network or browser.

## Tools

- `work_*` file tools inside the work folder; `input_list` and `input_read` for earlier producers' sources.

## Tests

- No test command. `core/artifact-ready` checks the source after the step (a document needs a `#` title and content;
  a page needs a content element and no external resource URL).

## Dependencies

- None.

## Deliverable

- The format's entry file in the work folder: `doc.md` (document) or `index.html` (web). Studio versions it.
- Never quote the run instructions in the deliverable.
