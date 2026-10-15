# Website access and original-task continuation

Final acceptance cards, task outputs, and both Library detail surfaces expose a version-pinned website link in a new tab. Links use the normal `/af/<artifact>/<version>/index.html` route with `noopener`; they do not use the restricted interactive preview route. Complete CSS, image, and video assets remain available.

A closed or cancelled unfinished task can request an explicit desktop continuation offer. Confirmation requires its exact task ID. The engine verifies the signed ledger, pinned workflow, current head and context, original card, and artifact bytes and annotation records. It creates a new captain-only card on the same task while preserving original cards, outputs, history, and requirements. It does not rerun completed producers or approve a card, merge, or purchase a retry. Confirmation is idempotent across event replay and server restart.

Only a quiescent, unambiguous source-owned captain card is eligible. Agent and hook readiness holds, ambiguous cancellation, changed or corrupt evidence, and unknown card modes remain on hold. Merged or genuinely approved completed tasks cannot reopen as pending approval; new revisions require a separate flow.

Validation: `bun run test:web-open-task-reopen`. Offline tests exercise the actual engine and HTTP/UI surfaces, two engine restart boundaries, stale and corrupt evidence, phone refusal, and full multi-file website popups. They make no vendor calls or live task changes. Browser screenshots cover desktop/mobile, English/Traditional Chinese, and light/dark themes. These tests are not proof of a real paid coffee workflow completing end to end.
