> Current execution (captain instruction, 2026-10-15): the pinned official CLI
> runs directly. Studio does not inject the historical Node preload, rewrite
> process APIs or filter official browser flags. The old guard fixtures below
> describe historical evidence, not the current process boundary. Snapshot input
> validation, deadlines and owned process cleanup remain. Official CLI browser
> defaults are used as shipped, including its no-sandbox flags.

# Optional local HyperFrames renderer

## R3 bounded authored-text validation

The R2 rejection identified synchronous repeated-prefix regex scans before the
subprocess deadline could run. This was originally a source-analysis finding;
the executed controls below are new measurements against frozen64d1196.
R3 changes only the adapter, owning native tests and this document. CSS
comments, url() and @import use forward-only searches: each delimiter is
consumed once, and unterminated input refuses immediately. Classic JavaScript
conservatively refuses standalone import/export tokens instead of searching
each export prefix for a distant from clause. HTMLRewriter delivers style and
script text directly, replacing wildcard rescans of raw authored markup.
External declaration detection also avoids a repeated-prefix tail scan.
The existing64MB/64file snapshot bounds and reference/host-reader restrictions
remain in force; no new dependencies, runtime capability or OS grants exist.

The browser-free owning suite now starts a separate watchdog-controlled child
for each hostile fixture, with the validator and heartbeat in the SAME child
event loop. The watchdog is outside that potentially blocked host. Against
unchanged64d1196, six roughly2MB repeated JS-export/CSS-url/CSS-comment/raw-style/
raw-script/DOCTYPE fixtures each produced zero heartbeats after validation
started and required the2second owned-child SIGKILL. All child exit events
were awaited before their planted temporary folders were removed. This is
actual0/6 red behavior, not a missing-module or setup failure:
/tmp/hf-r3-old-cpu.log, exit1.

The new source settles all six in approximately2–9ms, records six subsequent
host heartbeats per fixture, and observes a maximum heartbeat gap below18ms.
The owning command passes launch3/0 and lifecycle/reference/reader/CPU71/0
(/tmp/hf-r3-native.log, exit0). The six CPU controls are included in the
existing native owning suite, so no package-script addition is required.
Build and diff checks passed (/tmp/hf-r3-build.log). The retained coffee HTML
and real vendored GSAP script validate under the new scanner; existing real
MP4 render/playback evidence remains unchanged. No browser, model, login or
image-generation call was needed for this remediation. Native workflow
integration and independent source review remain separate requirements.

## R2 authored-reference reader boundary

The approved R2 scope is the existing adapter, source guard, native/containment
tests and this document. Before check/render, validate the complete bounded
snapshot, including nested assets/*.html, SVG attributes, stylesheets and
scripts. Asset references must name an existing manifest file. HTML numeric
and supported path character entities and bounded percent decoding happen
before validation. Absolute paths, traversal, schemes, unknown entities,
unresolved/dynamic references, disguised non-HTML compositions/non-CSS imports,
srcset/srcdoc, escaped CSS, module imports and
source maps fail closed. Authored source-video containers are unsupported:
video/audio/source elements are refused, and only verified MP4 output is
accepted. Raster input signatures are checked
before any native media discovery, so a playlist renamed .png is refused.
The Node preload does not constrain native ffprobe reads. This is a deliberately limited local composition
dialect; unsupported input is a HOLD, not a request to widen host authority.

The pinned CLI has additional host readers before a browser starts. Its
check→lintProject→lintMissingOrEmptySubComposition chain resolves an authored
data-composition-src and calls unrestricted readProjectFile. Compiler readers
also inline nested compositions, CSS imports/URLs and external scripts; media
duration probing can pass decoded media paths to ffprobe. Validate those
references before entering any CLI stage. Source-owned Node preload fences
sync, callback, promise and stream file readers to the owned run folders and
the canonical installed dependency root needed for trusted imports. No
authored reference gains dependency-root authority: references independently
must exist in the snapshot. Missing paths resolve their existing canonical
ancestor, and symlinks resolve before lexical traversal normalization. Remove
the formerly unused browser safePath helper rather than claiming it protects
upstream Node reads.

These are bounded input and known-reader controls, not OS containment. The
trusted pinned CLI, Node, Chromium and ffmpeg retain the user's OS authority;
the preload cannot constrain arbitrary native syscalls or replace an OS
sandbox. No outer video sandbox is reintroduced. Generic round/provider/image
sandboxes and Chrome's own sandbox remain unchanged.

The original rejection was source inspection only. New measured controls use
installed hyperframes0.8.159 and Node22.22.0: actual lintProject opened a
planted outside file once for each absolute and ../ reference before the fix
(/tmp/hf-r2-old-read-control.log). The owning fixture against unchanged1675
fails at the actual prelaunch marker assertion (/tmp/hf-r2-old-adapter.log).
With the unchanged old guard, the same real reader fixture reports three
outside opens, zero refused parser references and zero refused direct APIs
(/tmp/hf-r2-old-guard.log). The fixed owning suite passes launch3/0 and
reference/lifecycle/readers65/0 (/tmp/hf-r2-native.log), including two real
pinned-parser refusals, five direct reader APIs and positive owned nested
composition/style/script/media references. These are executed controls, not
module-resolution or setup failures.

The R2 adapter rendered the accepted unchanged photograph to coffee-r2.mp4,
259725 bytes, H264 960x540,24fps,12 seconds, SHA256
78cac52a6c3c397e9da93c190487be7060e74a0a2b77a844fb9c1a13fca9b1cd
(/tmp/hf-r2-render.log). Actual browser guard controls passed6/0
(/tmp/hf-r2-containment.log); actual MP4 playback advanced0.54 seconds,
sought10.5 seconds and decoded varied pixels with cleanupSafe true
(/tmp/hf-r2-playback.log). The build passed (/tmp/hf-r2-build.log).
Independent review and native Board workflow integration are still separate
requirements; this source adapter canary does not establish either approval.

Phase 2 exact scope approved: src/render/hyperframes.ts, tests/hyperframes-native.ts,
tests/hyperframes-containment.mjs, src/doctor.ts, package.json, bun.lock and this
file. Historical custom film renderer and workflow pins remain unchanged.

Official npm metadata resolves hyperframes 0.8.159 (Apache-2.0), which requires
Node >=22. Host PATH Node20 is insufficient. Use project-local exact Node22.22.0
(MIT) rather than changing system Node. Approved package installation and
browser/runtime cache remain isolated to this checkout and owned temporary
directories. Never update user skills/home configuration or invoke cloud/auth.

First inspect the installed pinned CLI and its local runtime/compiler/browser
behavior. Then build a source-owned bounded local-assets check/render adapter;
no generic shell exposed to the model. Prevent arbitrary local file, symlink,
network and WebSocket reads by authored composition code. Real output must
pass ffprobe metadata, duration and actual frames/playback checks. Missing
capabilities produce an honest unavailable state, not a fake MP4 or .html file
renamed to video. External code/runtime must be vendored locally with license
attribution and version/integrity evidence.

The real first image canary succeeded separately with Codex. This unit may use
its retained owned PNG as an input; it does not establish live image capability
or account access itself. Final integrated site/human refine/approval are later
native workflow and UI phases.

## Owned startup checkpoint (2026-10-15)

The renderer-specific profile leaves generic roundProfile unchanged. It adds
only the explicitly approved LaunchServices, distributed-notification and
WindowServer Mach names plus network-bind for the exact private temporary
`com.google.chrome.for.testing.<six alphanumeric>/SingletonSocket` path.
CFFIXED_USER_HOME and MAC_CHROMIUM_TMPDIR name the owned private folders.
There is no TCC, preference-read, Unix inbound/outbound or broad home grant.
The guard removes upstream Chromium sandbox-disabling arguments.

Actual non-browser socket controls showed SBPL accepts `{6}` syntax but does
not match it; six explicit character classes permit the intended socket while
seven-character and outside names remain denied. Browser-free owning controls
pass 3 launch-boundary assertions and 3 actual dedicated-profile socket checks.
The first control used overlong Unix paths and is retained as a fixture error,
not claimed as behavioral fail-first.

The individually approved startup using `{6}` ended exit1, cleanupSafe true,
owner20882; `/tmp/native-coffee-hf-one-startup-unix-20261015.log`. The corrected
single startup ended exit1, cleanupSafe true, owner24154/Chrome24160;
`/tmp/native-coffee-hf-one-startup-unix-explicit-20261015.log`. The socket denial
is gone. The retained crash report faults in
IONotificationPortGetRunLoopSource after an exact RootDomainUserClient IOKit
denial. No further startup or extra power-client grant was attempted.

The source adapter now embeds its guard for compiled delivery, confines
ffprobe to the same OS profile, snapshots inside its cleanup scope, returns
codec h264 only after metadata verification, and reports typed
HyperframesFailure.cleanupSafe. Source-owned progress callbacks report
snapshot/check/render/verify. These changes do not establish actual rendering
or playback. A build of the adapter and browser-free launch fixture passed;
no real MP4 exists at this checkpoint. The accepted image hash remains
unchanged. Native coffee workflow installation and real Board-driven media
acceptance remain required; a standalone canary cannot replace them.

## Captain-authorized video boundary revision

The captain explicitly authorized removing the video's outer OS sandbox
("移除影片沙箱吧 / 太麻煩了"). This replaces the earlier OS-sandbox requirement
for this dedicated renderer and its ffprobe only. Generic coding/provider
roundProfile and image isolation remain unchanged. Stop expanding Mach, Unix
socket or IOKit permissions; the renderer will not invoke sandbox-exec.

Retain Chromium's own sandbox, source-owned request/CSP restrictions, private
HOME/CFFIXED_USER_HOME/userDataDir/temp, pinned installed tools, fixed owned
loopback server, bounded input/output/process time, cancellation and verified
process-group cleanup. No user browser profile is used. The guard is NOT an
OS security boundary: the trusted Node/CLI process can access host resources
with the Studio user's authority. Do not claim OS denial of host private files.
Authored composition input remains snapshotted and symlink/config-free;
remaining browser navigation/network controls need actual negative controls.
Real encode/playback remains necessary; Board native integration must invoke
this same source adapter and preserve exact dependency/captain approval gates.

## Actual normal-process results

The revised owned startup succeeded exit0/cleanupSafe true, owner31033;
`/tmp/native-coffee-hf-one-startup-normal-20261015.log`. Actual page-guard
negative controls passed6/0 in
`/tmp/native-coffee-hf-normal-containment-20261015.log`: the unprotected control
reached planted local HTTP/WS/file targets, while the guarded browser preserved
its local page and refused outside-file navigation, external fetch/image,
external WebSocket and same-origin WebSocket requests. Both profiles were
private and process cleanup was verified. These are browser request controls,
not host OS isolation.

The same exported renderHyperframes adapter produced the real retained
`coffee-v1.mp4`:259725 bytes, H264,960x540,24fps,288frames,12.000 seconds,
SHA256 78cac52a6c3c397e9da93c190487be7060e74a0a2b77a844fb9c1a13fca9b1cd;
`/tmp/native-coffee-hf-render-normal-20261015.log` exit0. Independent ffprobe
confirmed metadata. Decoded start/middle/end frames show the accepted real
photograph and three distinct readable beats. Actual guarded Chrome playback
with production-style byte-range serving advanced0.53 seconds, sought10.5
seconds, readyState4 and decoded varied pixels; cleanupSafe true in
`/tmp/native-coffee-hf-playback-range-20261015.log`. Initial playback's fixture
omitted ranges and did not prove seeking; that earlier log remains retained.

This is a real adapter canary, NOT native Board workflow acceptance or a
captain's final whole-site approval. The adapter source subsequently tightened
its timeout to one total request deadline; final focused tests/source review
must bind that delta honestly. Native installation must forward its source-only
onProgress callback and typed cleanupSafe result into existing workflow state.

Final browser-free actual adapter lifecycle controls passed11/0 in
`/tmp/native-coffee-hf-adapter-lifecycle-20261015.log`: authored configuration
and symlinks refuse before subprocess launch, a genuine CLI failure drains,
a genuine hung CLI respects the total deadline, cancellation of an actually
entered CLI drains, and pre-cancelled work cannot launch. These fake CLI cases
never open a browser or model. `test:hyperframes-native` owns both that mode
and the3/0 launch-option boundary checks; it is in the ordinary test chain.
Actual browser request controls remain an explicit separate command with a
source-selected installed browser path. The outer OS-socket controls are
historical diagnostics and are no longer production acceptance requirements.
