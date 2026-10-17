# video: editor

## Briefing

- One producer (`draft`) writes an HTML film; Studio renders it to MP4, checks it, and the captain accepts or asks
  for changes. A later round starts from the version the brief names and its open notes.

## Environment

- An isolated work folder that holds `film.html` (the bundled template on the first round, the previous version
  after that). No shell, network, browser or external assets.

## Tools

- `work_*` file tools inside the work folder; `input_list` and `input_read` for earlier producers' sources.

## Tests

- No test command. After the step Studio renders the film and `core/artifact-ready` checks the MP4: it exists, has a
  video stream, and is exactly 1920x1080 (1080x1920 vertical).
- It also checks what the captain asked of the film on the MP4 itself: its length matches the length asked for, not
  every sampled frame is black, and a fade-in or fade-out the captain named is really there (first or last frame
  darker than the middle).

## Dependencies

- The render needs Node, Playwright with Chromium, and ffmpeg (ffprobe reads the size), all installed from Doctor.
  When one is missing the render is unavailable and the captain gets the "MP4 not verified" card; the film source
  stays.

## Deliverable

- `film.html` in the work folder, keeping the renderer contract below. Preserve what the notes do not ask to change.

## Renderer contract

- The film defines `DUR` (seconds), `build()`, `schedule()` and `render(t)`; the renderer calls `render(t)` for every
  frame time and captures only `#stage`.
- `#stage` is a fixed 960x540 px box (16:9), or 540x960 when the intent asks for vertical. Never size it with vw, vh
  or %. The MP4 is rendered at exactly 1920x1080 (1080x1920 vertical) from that box.
- A film without `#stage` fails with code `no-stage`; a stage of another shape is forced to 960x540 and the render
  notes say so.
- Everything the film shows is inline: no external URL in `src` or `href`.
