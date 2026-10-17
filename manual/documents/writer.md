# documents: writer

## Briefing

- One producer (`draft`) writes a Markdown document from the captain's request; findings and notes come back to it
  until the captain approves. Approval exports the document.

## Environment

- An isolated work folder that holds the previous `doc.md`, if any. No shell, network or browser.

## Tools

- `work_*` file tools inside the work folder; `input_list` and `input_read` for earlier producers' sources.

## Tests

- No test command. `core/artifact-ready` checks for a `#` title followed by content and no open annotation.

## Dependencies

- None. Studio renders HTML, DOCX and PDF exports itself after approval. The PDF is the previewed page printed by
  the local page renderer (a Playwright browser, system fonts, so CJK prints); it is kept only when it shows the
  document's first heading. Without the renderer, Latin-only text uses a built-in writer and other text gets no PDF
  (the warning names the missing renderer; Markdown, HTML and Word keep every character).
- Markdown supported: headings, paragraphs, lists, quotes, fenced code, rules and pipe tables.

## Deliverable

- `doc.md` with one `#` title (the document's title), written for its reader in plain language.
- Never quote the run instructions, the brief or the tool names in the document.
