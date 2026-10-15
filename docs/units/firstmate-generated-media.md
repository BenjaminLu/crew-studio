# Direct Firstmate generated images

Approved scope: src/host/types.ts, src/host/codex.ts, src/host/main.ts,
src/host/generated-media.ts, src/server.ts, src/m3.ts,
tests/firstmate-generated-media.ts, tests/fixture/codex-account.mjs,
package.json and docs/architecture.md.

A successful owned Codex imageGeneration item is staged by exact thread/turn/item,
and published through the existing MediaLibrary before successful turn completion.
Failed, interrupted, foreign, stale and conflicting items cannot publish. Publication
retains the vendor's actual model and creates an unapproved generated draft; it grants
no workflow or captain authority. Cancellation invalidates publication ownership.

Only bounded verified PNG bytes are supported. Strict inline base64 is preferred;
a saved path must be a newly written regular non-aliased file beneath the captured
Codex generated_images directory, read through a bounded no-follow descriptor.
No chat path, directory scan, global backfill, paid generation or account change.
Direct video/audio lack an attested host item contract and remain unsupported here.

Tests use the actual app-server fixture and managed Library, retaining fail-first
against the base implementation, plus ownership, cancellation and unsafe-file controls.

Saved-path traversal uses the existing desktop macOS libc/openat pattern with
O_NOFOLLOW at every descendant; other platforms require inline PNG and hold
saved-path publication rather than using a weaker pathname fallback. The normal
Library remains the only artifact writer and emits its existing change event.

Retained initial fail-first: /tmp/firstmate-generated-media-base.log and .exit
show the actual app-server success resolved with zero publication callbacks.
This test was run before production edits; no missing-import failure is counted.
