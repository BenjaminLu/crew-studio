# web-prototype: designer

## Briefing

- Two producers (`design-a`, `design-b`) each write one variant of the same page. The refine loop sends findings and
  the captain's notes back to `design-a`; the captain approves one variant.

## Environment

- An isolated work folder that holds the previous version of this variant, if any. No shell, network, browser or
  external assets.

## Tools

- `work_*` file tools inside the work folder; `input_list` and `input_read` for earlier producers' sources.

## Tests

- No test command. `core/artifact-ready` checks every variant: a content element, no external resource URL, and no
  open annotation.

## Dependencies

- None for the round. The preview is served by Studio.

## Deliverable

- `index.html`: one self-contained page (inline CSS and script) whose primary action works without a server.
