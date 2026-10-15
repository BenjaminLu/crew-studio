# Native pack genesis

Binding inputs: `../pack-genesis.md`, `../architecture.md`, `../check-contract.md` and `../v2-spec.md`. This unit replaces the legacy one-agent/static-eval genesis shortcut with a native Studio Task. Existing M6 skill editing remains compatible; generated domain packs do not gain authority from an agent report.

## Scope

- `src/pack-genesis.ts`: domain adapter, durable genesis/evaluation/shadow/proposal records and API.
- `src/server.ts`, `src/m7.ts`, `src/tools.ts`, `src/chat.ts`: native installer/routing and legacy genesis entrypoint delegation.
- `src/packs.ts`: immutable published version verification/activation, preserving existing built-ins/legacy installs.
- `src/runtime/index.ts`, `src/runtime/checks.ts`, `src/runtime/defs.ts`: only necessary installed check/skill loading seams, without new node kinds or privilege grants.
- `src/artifacts.ts`, `src/m3.ts`, `src/runtime/cards.ts`, `public/scard.js`: only necessary sample-label/acceptance callbacks; preserve artifact hashes and shared locator handling.
- `workflows/v2/pack-genesis.wf.yaml`, `workflows/skills/pack-genesis-*.md`, `packs/core/checks/pack-genesis-*/check.yaml`: native graph, pinned role prompts and measured evaluation checks.
- `public/pack-genesis.js`, `public/pack-genesis.css`, `public/index.html`, `public/m7.js`, `public/m3.js`: native creation/sample-label/evaluation/proposal/shadow/publication flow, using existing M3 locator review and Studio cards.
- `src/self.ts`, `src/main.ts`, `src/check-script.ts`, `src/runtime/engine.ts`: embedded Studio JS checks spawned only inside the existing OS sandbox; no interpreter dependency, global environment override, or unsandboxed fallback. Engine changes stay at interpreter selection and new input-hash algorithm metadata.
- `src/providers/stub.ts`, `src/providers/stub-agent.ts`: real native offline fixture tool calls, retaining historical legacy records.
- `tests/pack-genesis-native.ts`, `tests/pack-genesis-native-ui.mjs`, relevant existing M6/M7/locator/check regressions and `package.json`.
- This unit and related architecture/pack-genesis contract clarification only when implementation needs it.

The non-code worker may change generic runtime/card rendering in its own checkout. This adapter uses existing installer, agent mode and card mode seams; any unavoidable overlap is reported for integration, not overwritten in another worktree.

## Native graph and captain decisions

The graph uses only `agent`, `check`, `card`, `loop`, `hook`. Describe enters a native Task. A coordinator agent supplies one complete interview batch (inputs, outputs, tools, quality, deal-breakers, sign-off), then one captain card records all answers. The samples agent collects/generates immutable actual artifact versions; the captain labels good/bad and uses existing M3 pins/ranges/shared locators. Label completion refuses missing/invalid labels or changed artifact hashes.

A sandboxed author agent writes a manifest, workflow, skills and deterministic/judged check definitions. Untrusted generated content cannot install hooks/native functions, grant tools/network, answer cards or promote checks. A measured check node actually executes each proposed check on the labelled artifacts through the existing check/provider contract. Static skill text matching is never evidence that a check works.

Every unmatched human finding and every false machine finding yields a proposal bound to the exact eval-set hash and candidate check/file hashes. The captain may accept, edit or reject per proposal. Acceptance/edit leads to a sandboxed refinement round and remeasurement; stale proposals cannot apply. Rejection is durable and the same rejected fingerprint is never offered again, including after restart. The existing runtime owns round caps, cancellation and waiting cards.

Shadow work is an actual native Task pinned to the candidate pack/check hashes. All proposed checks remain advisory. Comparison uses the captain's final acceptance/rejection of the exact resulting artifact version, never an agent's self-report. Overrides become new labelled samples. Promotion is a captain-only card per check: configured N matching outcomes among M completed shadow Tasks, with distinct task identity and no double counting. Below threshold the check remains advisory and visibly needs the captain's eye. Judged promotion additionally preserves independent vendor/round quorum and cannot solely prove a done line.

Publish requires completed measurement and the captain's explicit publish decision. It writes an immutable version containing the manifest, workflow/skills/check files, frozen eval-set identity and measured metrics, with a deterministic file hash pin. Existing versions cannot be overwritten; changed/missing/unexpected files fail verification before load or execution. Publication is local only.

## Measured data

Evaluation stores actual check results, input/artifact hashes, check version/hash, provider/vendor identities, locators and signed ledger references. Precision is matched predicted findings / all predicted findings; recall is matched labelled findings / all labelled findings. Matching is by sample, finding class and compatible shared locator, with one-to-one matching. Undefined denominators are explicit, never fabricated 100%. Good samples establish false-positive evidence. Judged vendor agreement uses actual independent provider results and an explicit denominator; missing/error votes do not count as agreement.

Each accepted final shadow decision is persisted once. Retro proposals carry before/after metrics obtained by rerunning the proposed check changes on the frozen eval set. No measured claim comes from prose, a stubbed engine pass, or a guessed threshold. Captain overrides and rejected proposals survive restart.

## Testable done lines

1. API/chat entry creates one native Task whose persisted steps derive real Task/Rounds; one complete interview batch is answered once, with actual provider agent execution.
2. Real good/bad sample artifact versions are labelled through M3; sample hashes and human locators are validated and pinned. A changed sample or invalid locator is refused.
3. Actual sandboxed deterministic scripts and judged providers execute on the same labelled samples; precision/recall, misses, false hits and vendor agreement reflect their outputs, including error/empty-denominator cases.
4. Per-miss proposals bind eval/check hashes; accept/edit remeasure, stale proposals fail, reject persists and is not re-proposed. Unmatched human annotations propose a new check.
5. Actual pinned native shadow Tasks run advisory checks; final captain acceptance compares exact outputs, records overrides as labels and avoids duplicate counting.
6. Per-check N/M promotion requires completed distinct shadow decisions and an explicit captain card; refusal/below-threshold leaves checks advisory and in needs-your-eye. Judged quorum and done-line rules remain enforced.
7. Published versions freeze eval data/metrics and all executable/prompt hashes. Overwrite, tamper, path traversal, symlink escape, hidden/unexpected files and privilege escalation are refused; legacy packs/M6 remain usable.
8. Restart preserves interview/label/proposal/promotion waits, rejection memory and pinned task state. Cancel withdraws cards, stops agents/checks and cannot publish or append late results; archive/delete refuse in-flight native work (T-185 semantics).
9. Real browser flow works at 1440/390, light/dark, EN/zh-TW with new captain cards, M3 review links, measured results and promotion needs-your-eye visible; no overflow or Firstmate/notice obstruction.

## Validation

Fail-first runs against `f7a7424` must fail on absent native workflow/measurement/promotion/publication behavior, not an unrelated setup error. Focused tests use the real native engine/server, actual stub provider tool calls, real check executables and real captain card answers. Reuse existing sandbox/privacy/locator/check tests; do not use real vendors, install dependencies, alter user settings/services or perform GitHub writes. Collect durable exits and exact source hashes before a frozen handoff; root owns independent review and final full-suite integration.

## Executable provenance and compatibility

Candidate measurement first captures a bounded, regular-file source snapshot, verifies every file against its SHA-256 inventory, and reads manifests and prompts from those captured bytes. Check execution receives the original verified script SHA, verifies its copied script, and imports the same checked buffer. A concurrent draft change and restoration therefore cannot substitute executable bytes for the recorded source identity. Immutable publication binds the complete source tree, frozen eval-set contents and measured results with full SHA-256 and the existing ledger-key signature.

New measurement input hashes declare `canonical-json-v2`; nested object keys are canonicalized while arrays preserve order. Historical ledger bytes and legacy check manifests retain their interpretation. Generated native producers explicitly support web and document output; unsupported producer requests and artifact-kind mismatches fail closed without removing historical pack/artifact reading or evaluation. The real offline end-to-end fixtures cover web output and deterministic plus judged checks; they do not establish real-vendor quality or other media producer support.

Judged manifests explicitly declare `judge.distinct_providers: true`. Pack-genesis agreement compares actual resolved provider identities, not requested vendor labels or model names; duplicate or unavailable identities cannot promote. The separately reviewed generic judge-resolution unit owns global explicit-provider enforcement and compatible vote metadata. Ordinary existing independent-context quorum remains unchanged.

The embedded JavaScript helper is supported on macOS through the existing OS sandbox. It has no external JavaScript/Python interpreter dependency and refuses direct unsandboxed execution. Compiled fixtures use an empty tool PATH and ordinary readable outside-root canaries with successful unsandboxed controls, then prove actual sandbox denial of outside reads/writes, input/script modification and local TCP access. Unsupported platforms fail closed.

Additional approved paths: `tests/pack-genesis-native-binary.ts`, `src/assets.gen.ts`, and `src/bundled.gen.ts`. The build refreshes only this isolated checkout's tracked approved assets. Focused UI captures include each native authoring stage, publication and cancellation at 1440/390, light/dark, EN/zh-TW, including middle and end scroll positions. Root owns independent review and final combined full-suite acceptance.

## R2 generated authority and promotion reconciliation

Generated workflow definitions use an explicit structural field allowlist before normalization or pinning. Workflow policy overrides may contain only bounded `round_timeout_s` and `flaky.retry` quality settings; tools, egress, provider/model configuration, hooks, gates, unknown fields and executable/path arguments are refused. Agent roles retain only their declared pinned skill, and check references cannot redirect providers or prompts. Generated checks remain advisory until the captain's measured promotion decision.

Each successful measurement rebuilds promotion entries from exactly the current manifest, removes obsolete checks and records its current N/M. Changed candidate or eval-set identity, or changed threshold, clears prior selection/blocking state. Shadow evidence is still restricted to the exact measured candidate; three completed comparisons cannot satisfy a refined five-of-five requirement. A real native author/refine fixture changes two-of-three to five-of-five and publishes only after five completed matching shadow Tasks. Historical R1 test successes do not constitute acceptance of its independently rejected candidate.

## R3 supplemental privacy and rendered evidence

The synthetic private-path refusal fixture constructs its test-only path from runtime segments, retaining the actual generated-skill privacy guard without committing a home path. Promotion selection uses an adjacent checkbox/text label with at least a 44px target; clicking the actual label selects the backend-bound control.

Additional scoped fixture seam: `src/providers/stub-agent.ts` explicitly authors a throwing check only for the `STUB_PG_CHECK_ERROR` offline request. Actual normal native measurement/preview produces its error counts and undefined denominators; no state or metric is fabricated. Browser evidence targets the last interview inputs and save action, first sample review/labels, populated tables, expanded full hash evidence, disabled below-threshold promotion and actual refusal feedback. It also covers actual M3 notes in both languages/themes and 320 plus each CSS breakpoint boundary. Original full-page/middle/end captures remain.
