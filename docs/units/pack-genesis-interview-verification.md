# Pack Genesis interview regression evidence

- Verification date: 2026-10-16.
- Related task: R-023, retry of R-010. This report covers the interview contract; it does not mark the live task completed or merged.
- Product implementation was already present. This change strengthens regression assertions without changing the form, runtime, permissions, or production data.

## Executed standalone interview verification

```sh
PATH="$PWD/.crew-studio/tools/bun/bun-darwin-aarch64:$PATH" \
  CREW_TEST_IN_PROCESS=1 bun tests/pack-genesis-interview.ts
```

- Result in the CLI sandbox: **44 passed, 0 failed**, exit 0.
- Local capture: `/tmp/r023-interview-standalone.log` (temporary evidence, not a durable artifact).
- The harness uses temporary data and a stub provider. In-process transport calls the same tool-token validation and tool dispatch without opening an HTTP listener. This is native engine regression coverage, not real model or browser E2E evidence.
- The standalone entry cleans up its isolated native task after interview assertions. It does not run check authoring, nested script sandboxes, shadow comparisons, or publication.
- `tests/pack-genesis-native.ts` is unchanged and remains the full native suite. Passing the interview entry must never be reported as passing that full suite or substituted for a requested full-suite gate.
- No sandbox guard was disabled, and no dependencies were installed or external network enabled. Captain's execution-environment verification must separately run this entry inside the actual worker sandbox.

## Covered acceptance criteria

- The native interview produces all six categories in one batch, and the serialized card exposes the current form and batch hash.
- A complete answer envelope persists all six answers on the original answered card and advances to sample review.
- Missing, whitespace-only, non-string, array, unknown-key and oversized answers are rejected.
- Stale card, visit and batch identities, bare legacy answer objects and malformed non-JSON input are rejected.
- Each invalid structured submission leaves the original card open, preserves its bytes, and retains the saved partial draft.
- Filling the five remaining draft fields preserves the first saved answer without prematurely submitting the card.
- Stale draft revisions cannot overwrite newer saves. Phone mutation remains forbidden.
- Read-time hydration of an untyped historical card exposes its saved form without rewriting the historical file. Fixtures use isolated temporary data; no existing Studio task or card is rewritten.

## Browser and handoff boundary

- `tests/pack-genesis-native-ui.mjs` already describes six-field rendering, inline missing-answer guidance, draft persistence across Inbox / Task / Pack Genesis routes, reload and submission, plus viewport/language/theme coverage.
- That browser script was inspected but **not executed** in this verification. No new visual, interaction, or real-model success is claimed here.
- Captain still needs to verify the visible form through the approved browser tool, accept the live R-023 result, and complete its normal workflow gates. Existing R-023 status is intentionally unchanged by this test.
