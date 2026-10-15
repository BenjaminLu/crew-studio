# Review depth follow-ups (handoff 10, 9, 8)

Why: an absent read plan currently looks like a verified empty diff; a previous unverified attempt can affect a later step-back card; a sentence-ending period prevents named-file priority.

What: review plans bind to the run, node, visit, retry attempt, base and current head. Missing, malformed or stale plans fail unverified and cannot record approval. A prepared genuinely empty diff remains valid. Preparation clears attempt-only unverified/depth context while retaining the prior refusal brief. Path matching accepts sentence punctuation, quotes and colons and refuses longer paths, extensions and children; budget priority stays deterministic.

Done:
1. Real verdict tool/native/after callers refuse absent, malformed, stale-attempt and stale-head plans; no approval is recorded. Prepared empty diff passes.
2. A new attempt clears reviewUnverified but retains reviewBrief; an ordinary later failure produces the ordinary step-back card.
3. Named files followed by punctuation remain first under a constrained read budget; similar longer paths do not match, and repeated preparation yields the same priority.
4. Existing review-depth, local coding smoke and GitHub foundation regressions pass. Fail-first is retained for all three classes on fe298397aa4702b527d127340f42a3c56ed92674.

Scope: src/domain/code.ts, tests/review-depth.ts, package.json (test alias), this document. No UI layout, model/policy/permission, service or remote changes.

SWEPT: verification-plan validity, attempt-only context, exact path-name priority. Searched reviewPlan/reviewDepth, review_verdict, prepareReview/after, and step-back card callers. Both tool and native paths now refuse invalid plans; after refuses injected approval. One preparation reset site and one names matcher were fixed.

Evidence: review-depth 77/0, local coding smoke 27/0, GitHub foundation 71/0. Logs /tmp/review-depth-safety-{green,code,github}.log and .exit=0. Identical new review-depth assertions against fe298 source fail 59/18, /tmp/review-depth-safety-failfirst.log/.exit=1. All three classes are independently reached, including malformed-plan exceptions on the baseline. Tests use local throwaway repositories and stub models only; no full suite started.

## T185 upgrade behavior (review R2, must-fix 1)

An in-flight review saved before plan bindings existed cannot reuse its completed reads to approve under the new verifier. Its structurally valid but unbound plan fails native verification, the verdict tool refuses it, and after requests the normal retry without recording approval. Refusal does not add a binding to the old plan or rewrite historical verdict records. The retry prepares a new bound plan and requires fresh reads; a verified verdict then appends normally while preserving earlier history. No migration rewrites stored reviews.

Regression: tests/review-depth.ts T185 persists a complete-read unbound review context, restores it, exercises native/tool/after refusal, and recovers via fresh retry preparation and real read/verdict/after callers. The same assertions against fe298 source must reject its acceptance of the legacy plan.

R2 evidence (isolated /private/tmp/crew-studio-review-depth-r2-from8a): review-depth 84/0, smoke-code 27/0, GitHub foundation 71/0, all exit 0. Logs /tmp/review-depth-r2-isolated-green.log, /tmp/review-depth-r2-code.log, /tmp/review-depth-r2-github.log and corresponding .exit files. Pre-fix fe298 source with identical candidate tests: 61/23, exit 1, /tmp/review-depth-r2-failfirst.log; all three T185 refusal callers and historic-verdict preservation on recovery fail on that control. No production change and no worker full suite.
