# Pack Genesis interview cards across every entry

Scope: `package.json` (one owning alias and main-chain wiring), `src/pack-genesis.ts`, `src/runtime/cards.ts`, `src/runtime/index.ts` (read-only card serializers), `public/scard.js`, `public/pack-genesis.js`, `public/styles.css`, `tests/pack-genesis-native.ts`, `tests/pack-genesis-native-ui.mjs`, owning `tests/intent-card.ts` and `tests/intent-card-ui.mjs` regressions, this file.

A source-owned schema-1 interview descriptor carries six localized questions, card visit and canonical SHA-256 batch hash. Every actual card entry uses one common form. Each missing answer gets localized inline guidance; no user JSON entry is needed. Answers remain a complete batch and only an explicit captain submit consumes the card.

Authenticated Mac-only POST `/api/pack-genesis/<run>/interview-draft` stores bounded per-card/visit/batch answers, with optimistic revision checks. GET returns the matching current draft. Unsupported methods, stale card/visit/hash, terminal runs, unknown keys and oversized data refuse. The generic renderer derives this same-origin route from validated card identity, not a supplied URL. No generic permission or phone mutation policy changes. The existing Engine requires no changes: optional card metadata is added only by the read-only Cards.view serializer.

Existing pending Pack Genesis cards are hydrated only in read-only view serialization: actual active run/node/card/visit, trusted run evidence and the exact bilingual questions in the persisted card must match. Historical card files and answers are not rewritten. New question batches receive a signed source record; legacy cards preserve their provenance and obtain an appended binding only on explicit save/answer. Mismatches hold. Non-Pack-Genesis untyped notes remain unchanged. Pack interview submissions, including upgraded old cards, use the current typed envelope; old cards are not grandfathered into unpinned free-text submission.

Tests cover missing fields, stale batches, persisted drafts, existing untyped cards, all three real UI entry points, reload, exactly-once submission and ordinary cards. UI captures use 390/1440, EN/zh-TW, light/dark and actual app APIs, not static HTML. No real model, login, remote or user data operations.

The draft-save SSE exposed a pre-existing synchronous blur redraw in the specialized page. Its deferred callback now waits one event tick, rechecks route ownership, and defers again while another text field or active pointer owns the page. Actual rapid field transitions must preserve all six values before approval. Inline error colors use the existing light/dark `--bad` token.

`test:pack-genesis-interview` runs the real cross-entry/viewport fixture on a current native task and is wired once in both the main chain and owning pack-genesis alias. Optional `PG_LEGACY_BOOT_ROOT` proves actual prior-version task recovery without making an old checkout a product or ordinary-test dependency.
