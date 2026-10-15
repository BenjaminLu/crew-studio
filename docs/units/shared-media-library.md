# Shared managed media Library

Baseline b2ff; independent of the preserved coffee and staffing worktrees.
Completed generated image/video bytes and supported imported audio belong in
CREW_DATA/artifacts/<id>/vN/files. They become visible draft versions immediately,
with Task/project/generation/provider/model/dependency provenance. Visibility is
not approval. Temporary directories hold only intermediate/probe bytes.

Exact scope: src/artifacts.ts, src/m3.ts, public/m3.js, public/m3.css,
new src/media-library.ts, src/providers/media-jobs.ts, tests/media-library.ts,
tests/media-library-ui.mjs, package.json, this document and regenerated tracked
assets. No annotation or staffing changes. No live data import without explicit
captain action. Existing canary files remain test evidence; an import must say
import and never claim another generation.

The source publisher records a signed immutable operation intent before invoking
an owned generator. An exact completed request is idempotent across reload;
interrupted uncertain requests HOLD without rerunning paid generation. Completed
bytes are validated before an atomic managed version publish; source owner and
cancellation are checked again before publication. Signed receipt and exact file
hashes bind output and ownership. Generic approval/refinement/render/lane paths
cannot mutate source-workflow-owned media. Ordinary imported artifacts retain
existing approval semantics. No polling, folder watcher or private-file scan.

Image and HyperFrames job wrappers call the existing real adapters and require
the publisher; low-level adapter tests remain data-store independent. These
wrappers are not yet product callers on this baseline. Coffee will consume them
in its separate integration. Audio supports stored/imported playable media; no
audio generation service or arbitrary CLI output auto-discovery is claimed.

## Supported coverage and validation

`mediaJobs(library).image` and `.video` invoke the real dedicated Codex image and
HyperFrames adapters and always publish through the managed store before
returning a result/link. They are source integrations, not an HTTP generation
endpoint. No existing arbitrary CLI invocation or unswitched coffee draft is
claimed covered. A caller must retain its owned queue lease until adapter and
publisher cleanup settle. MediaPublicationFailure.cleanupSafe=false retains the
probe temporary directory and requires a capability HOLD rather than releasing
ownership on unverified process death.

PNG output uses the image adapter's complete structural validation. MP4 and
supported WAV/MP3/M4A/Ogg audio require installed local ffprobe to validate a
positive-duration stream; browser playback tests separately prove decoding of
the planted test files. No audio generation provider is installed or inferred;
the generic audio regeneration endpoint refuses explicitly. Ordinary explicit
audio import retains import provenance and its existing approval path.

The managed namespace is reserved and rejects generic mutation regardless of
missing/damaged ownership context. The source ledger signs intent, ready-byte
hash, and completion. A crash after atomic rename can repair the missing
completion only from a matching signed ready receipt and intact exact version;
no producer replay. Unknown/interrupted intent instead requires a fresh explicit
generation. Symlinks in managed serving/replay paths are refused. The existing
non-managed shared asset behavior remains intact.

Verification uses actual locally synthesized PNG/MP4/WAV fixtures, not vendor
output. The legacy audio import API counterexample returns 400 on baseline b2ff
and 200 on the new source with the identical valid WAV request. Real user sample
imports and real paid generation were not run, and no live Library was changed.

## R2 closed review findings

The first revision let ffprobe autodetect bytes before checking its returned
format. R2 first validates a bounded standalone container signature/structure,
then forces the exact mov/wav/mp3/ogg demuxer and matching format whitelist.
ffprobe receives only `pipe:0`, backed by the source-owned temporary file on
stdin; its protocol whitelist is only `pipe`. MOV external data references and
absolute-path references are disabled. A fixed quoted source shell exec adapts
the existing owned process helper; no authored value supplies executable,
arguments, or filenames. Existing process deadline/output caps/verified group
cleanup remain. Frame counting requires an actual decoded stream, including WAV
on nonseekable input where format duration is unavailable.

Planted FIFO and loopback HTTP playlist controls report zero reads on both old
and new source with the installed ffprobe: its own HLS extension restriction
already refuses that reproduction. This is not claimed as a reproduced old
host/network leak or an OS boundary. The actual fail-first assertion is native
parser entry: old source invokes it twice for authored playlists; new preflight
refuses both before native entry. Forced protocol/demuxer restrictions additionally
protect container parser paths without trusting autodetection or optional
playlist availability in a particular ffprobe build.

Library text-only media/date filters now retain visible labels inside their
owning component on phones and wrap as needed. Sidebar icon-only rules remain
unchanged. The actual old 320px control fails visible-label assertion; R2 tests
all eight labels, Audio selection, each date selection, viewport fit and actual
media playback across 320/390/1440, English/Traditional Chinese and light/dark.
