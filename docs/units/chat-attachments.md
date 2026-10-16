# Firstmate chat attachments

The captain can drop, paste or pick PNG, JPEG, WebP, GIF and PDF files in the right-side
Firstmate chat. They go with the next message and stay in the chat history.

Upload: `POST /api/main/attachments` (JSON, base64), behind the usual write guard; a phone
only when phone driving is allowed. The type comes from the file's first bytes. Caps:
images 10 MB, PDFs 20 MB, 5 files per message (`src/attachments.ts`).

Storage: `data/chat-attachments/<sha256>.<ext>`, a 0700 folder and 0600 files written through
an O_EXCL temporary file; no symlink is written through. A message keeps the label it was
sent with. `GET /api/main/attachments/<sha256>` reads a file back (`private, no-store`).

Retention: a sent file stays while the kept chat history (below) or a queued message references it; once the
history rotates that message out, the file goes. An upload that was never sent goes after 24 hours (removed chips,
uploads the host refused, abandoned drafts); stray `.tmp-*` files after an hour. Studio sweeps at start and every hour.

Hosts:
- Claude CLI (stream-json): image and document blocks, base64. Refused with a typed reason:
  an image over 3,932,160 bytes (the CLI's base64 limit of 5,242,880), over 8000 px on a side,
  a PDF over 100 pages, or over 18 MiB of files in one message. The page count is the /Count of the
  catalog's root /Pages dictionary (newest revision); when Studio cannot read it (compressed object
  streams, an indirect count) or cannot read an image's size, it is not checked: the chip warns that
  Claude refuses PDFs over 100 pages (images over 8000 px) and the send goes ahead.
- Codex app-server: images as `localImage`. Its protocol has no PDF input, so the turn text
  names the stored file's path and says Codex has not seen it; every file's hash is re-checked
  before Codex gets its path.

A files-only message counts as the captain's input for captain-only native tools; its words are
the line "(The captain sent N files without text.)".

## Chat history

The panel's log is kept in `data/chat-log/log.jsonl` (folder 0700, files 0600), one line per item, each
redacted before it is written; it rotates at 2 MiB and keeps two older files (`log.1.jsonl`, `log.2.jsonl`).
Each line carries the primary session it belongs to (host, id, model). Studio reloads the newest 400 lines
at start; earlier sessions show as their own labelled blocks, and starting a new primary deletes nothing.

## Errors from outside Studio

A failed turn, a vendor refusal (quota, sign-in), an API or network error, a time-out, a CLI process that
stops, an attachment that cannot be sent, an upload that never reached Studio and a send Studio refused each
show as a typed notice in the chat (`src/host/external-errors.ts`): its class and code, Studio's reason, and
the exact external message with credentials and control characters removed, at most 600 characters.
