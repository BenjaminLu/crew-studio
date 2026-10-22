# UI information density — draft evidence

**Draft pending independent review.** The delayed HTML thumbnail failure seen in native Chrome is explained and fixed (see "Delayed thumbnail timeout" below). No merge or deployment was performed.

All images use synthetic conversations, permission prompts and local media fixtures. They contain no customer conversation or real account. Before: original `96b1098e` frontend against the same fixture. After: candidate frontend (`m25.js` SHA256 `748a51f6049aa63f075001e54283429c83c9f39a41063a3fae87aa685af8db70`; `m3.js` SHA256 `60d1d2964d108d98c0bafa4939e93354879813b583ded54aeea1e830129b7c96`). Browser screenshots are automated test evidence, separate from the root agent's native acceptance.

| Area | Before | Candidate |
| --- | --- | --- |
| Firstmate, desktop | ![Before: repeated tool rows](before-chat.png) | ![After: collapsed activity groups](after-chat.png) |
| Library, desktop | ![Before: blank web cards](before-library.png) | ![After: explicit preview states](after-library.png) |

![Expanded navigation, 1100 by 560, Projects and Settings visible](after-short-navigation.png)

![Narrow Library, 390 pixels](after-narrow-library.png)

## Implemented behavior

- Consecutive tool activities collapse into one expandable summary; approvals, errors and running state stay outside. Expansion and reading scroll survive repaint. The existing server's 200-record window is retained by the client, rather than truncating to 80 records before grouping. No success state is inferred from a tool-call log.
- Chat starts at 400 pixels, clamps resize to preserve workspace, and remains a full-width phone sheet. Labs starts collapsed, remembers choice, and reveals the current deep-linked parent without enabling the Labs feature flag. Short desktop navigation scrolls independently above Projects and Settings.
- Library cards use the latest primary file and a consistent 170-pixel slot. Missing versions/files, script-only HTML, empty canvas/iframe, refused capability, failed loads and timeouts have named states. HTML thumbnails keep an opaque sandbox with scripts disabled; the HTML analysis uses an inert template. Full managed video detail geometry is preserved.

## Validation and limits

- `node tests/ui-information-density.mjs`: 35 assertions pass in bundled Chromium / installed Chrome (channel `chrome`), including a 96-tool burst, immediate repaint, narrow/short layouts, all preview states, actual delayed iframe heading, and a direct Library load that fetches the delayed preview exactly once. The same new assertions fail against the original frontend (no activity groups).
- Existing suites: Firstmate chat 35/0, backbone navigation 51/0, real media Library UI 122/0. Privacy/OpenCC checks pass in the managed worktree. These are fixtures, not paid-agent or external-service tests.
- Required core is run separately from full CI. The managed worktree under the operator's protected configuration directory cannot run an unchanged staffing fixture CLI inside its sandbox. An exact-byte snapshot under the OS temporary directory, with normal Git metadata and locked dependencies, is used for core verification. Final result is reported in the PR; a green snapshot is not a claim that the original worktree command passed.

## Delayed thumbnail timeout

The root agent personally verified chat grouping, resize, Labs, short-height reachability, static/image/video previews and named fallbacks. Its native automatic delayed thumbnail issued serial parent HTML requests about every 1600 ms, each HTTP 200, until the 10-second abort, and no iframe was created.

Cause: opening `#/library` directly renders the Library seven times in about 40 ms while the artifact and library lists load (four renders from `loadList`, three from `loadLibrary`, confirmed by render stack traces). Every render rebuilt every card, and each card started its own capability request and parent `fetch`, so seven identical fetches left the page within milliseconds. The same recorded trace shows seven capability requests per card. Chrome's HTTP cache lets only one request per identical URL proceed at a time, so the server saw them one after another, each taking the fixture's 1600 ms. The visible card belongs to the last render; its fetch queued behind six discarded ones and reached its 10-second timeout before running. The tagged manual control used a different URL, so it never queued.

Fix: renders share one in-flight load (capability, fetch and analysis) per preview URL (`staticPreview` in `public/m3.js`). In headed installed Chrome, the same seven renders now make one capability request, one parent fetch (1601 ms) and one iframe navigation, and the card reaches `ready`.
