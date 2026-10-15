# Coffee local-render visibility

The Crew page must distinguish local HyperFrames work from LLM agents. The coffee source owns a lifecycle registry, installed into the existing agents endpoint as additive `localJobs`. A job starts only after actual queue admission, reports only adapter callbacks, and settles after publication/cleanup. Cancellation and uncertain process death retain truthful cleanup state; no invented percentage, heartbeat, OS poller or LLM identity is introduced. Recent terminal rows are bounded; unsafe cleanup rows remain held. This registry describes this server process, not reconstructed active work after restart.

Scope: src/domain/coffee-kit.ts, src/runtime/index.ts, public/runtime.js, tests/native-coffee-kit.ts, tests/studio-agents-ui.mjs, package.json and this document. Existing workflow, captain approval and media receipts are unchanged.

## Evidence

The actual native coffee fixture asserts the renderer owns a queue lease before its row appears, callbacks update the stage, successful publication settles verified cleanup, returned snapshots cannot mutate the registry, and source events are emitted. Separate timeout, Task-cancellation and unverified-cleanup runs verify terminal outcomes and real capacity ownership. The cancellation control caught and corrected a replacement-AbortController classification mistake: the row now uses the exact signal passed to the renderer. Full native fixture: 58 assertions; each failure control: 35 assertions. These are explicit simulated adapters, not real media-generation proof.

The isolated Crew browser fixture checks running and terminal rows, timestamps, exact Task link and absence of fabricated agent rows at phone/desktop widths: 9 assertions. The old implementation fails the native lifecycle fixture before a complete bundle is offered. Existing historical failing intermediate controls are retained outside the repository; no full suite or paid vendor calls were run for this unit.
