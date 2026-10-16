# Firstmate chat attachments

The captain can drop, paste or pick PNG, JPEG, WebP, GIF and PDF files in the right-side
Firstmate chat. They go with the next message and stay in the chat history.

Upload: `POST /api/main/attachments` (JSON, base64), behind the usual write guard; a phone
only when phone driving is allowed. The type comes from the file's first bytes. Caps:
images 10 MB, PDFs 20 MB, 5 files per message (`src/attachments.ts`).

Storage: `data/chat-attachments/<sha256>.<ext>`, a 0700 folder and 0600 files written through
an O_EXCL temporary file; no symlink is written through. A message keeps the label it was
sent with. `GET /api/main/attachments/<sha256>` reads a file back (`private, no-store`).

Retention: an upload that was never sent goes after 24 hours (removed chips, uploads the host
refused, abandoned drafts); stray `.tmp-*` files after an hour. Sent files stay as long as the
history may show them. Studio sweeps at start and every hour.

Hosts:
- Claude CLI (stream-json): image and document blocks, base64. Refused with a typed reason:
  an image over 3,932,160 bytes (the CLI's base64 limit of 5,242,880), over 8000 px on a side,
  a PDF over 100 pages, or over 18 MiB of files in one message.
- Codex app-server: images as `localImage`. Its protocol has no PDF input, so the turn text
  names the stored file's path and says Codex has not seen it; every file's hash is re-checked
  before Codex gets its path.

A files-only message counts as the captain's input for captain-only native tools; its words are
the line "(The captain sent N files without text.)".
