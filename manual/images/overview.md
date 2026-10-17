# images

## Briefing

- The `draft` step runs as the `image-worker` role: its short image skill leads the request, then the captain's
  request (and, on a revision, the cumulative notes and the parent image) goes to Codex image generation. The step
  records the role skill it used. The captain accepts or asks for changes.

## Environment

- Generation runs through the signed-in Codex account in Studio's sandbox. No other provider generates images.

## Tools

- None for a model: Studio calls the image tool itself.

## Tests

- No test command. `core/artifact-ready` checks that the PNG is valid and bounded.

## Dependencies

- A Codex sign-in (Doctor shows it). Firstmate never starts a sign-in; it asks the captain.

## Deliverable

- One PNG, versioned with the refinement it answered.
