# GitHub coding and external review workflow

Status: implementation in an isolated worktree from 31b284b9. No actual external
write, reviewer contact, account registration, paid model call or credential edit
is authorized by this unit. The supplied real PR authorizes read-only discovery;
company response content stays private evidence and never enters fixtures/docs.

## Behavior and authority

Prepare a reusable draft from an issue/brief, registered local repository and exact
GitHub repository. Draft creation, graph editing and saving require no staffing.
Running requires the existing captain-confirmed project/grant, scoped coding
specification, role/model/effort/skill approval and native admission. Reuse the
existing isolated worktree, coding/tests/fix rounds, typed GitHub transport,
lease-aware publication and authoritative required-CI checks. Publish a Draft PR
only after an actual captain card authorizes the exact target. No merge edge.

A strict PR URL parser accepts https://github.com/OWNER/REPO/pull/NUMBER only.
Reading must match an already approved project GitHub grant; the URL cannot grant
authority, choose an arbitrary API origin or cause token forwarding. Scan all
bounded pages of reviews, inline comments, issue comments and check runs, checking
PR identity/head before and after. Deduplicate actual endpoint+id records. Show
candidate immutable account IDs with logins and evidence, never guessed bot names.
Captain confirms multiple required/advisory account IDs and trigger policy.
Default trigger is manual/no contact. This unit never posts comments or reviews;
unsupported automatic trigger modes HOLD rather than silently send.

Only GitHub review APPROVED with exact commit_id counts as an approval. A current
CHANGES_REQUESTED, unresolved current inline finding, missing required response,
permission/timeout/pagination error or unknown binding cannot become green. Plain
issue comments and a SHA mentioned in their body are unverified claims unless a
separately captain-confirmed trusted transport policy exists (not implemented by
this first unit). New PR head invalidates prior approval. Persist absolute wait
deadlines and exact target/policy, reuse shared poller ownership, cancel/delete
unregister and abort reads, and do not emit late cards/results. Findings feed the
existing fix loop; successful final state is captain-ready, never merged.

## Exact scope

- src/domain/github-review-workflow.ts (new)
- src/adapters/github.ts
- src/domain/code.ts
- src/domain/remote-ci.ts
- src/domain/staffing.ts
- src/firstmate-staffing.ts
- src/runtime/defs.ts
- src/runtime/index.ts
- src/firstmate.ts
- workflows/v2/github-review.wf.yaml (new)
- public/runtime.js
- public/runtime.css
- src/bundled.gen.ts (generated only)
- tests/github-review-workflow.ts (new)
- tests/github-review-workflow-ui.mjs (new)
- tests/lib/github-simulator.ts
- package.json
- docs/architecture.md
- docs/code-firstmate-pipeline.md
- docs/units/github-review-workflow.md

No generic Engine/permission changes, global config, existing Task/ledger rewrite,
actual main checkout changes, credential changes or broad network permission.

## Evidence plan

Meaningful base controls use actual APIs: unsupported scan refuses/no fake found
accounts; source template unavailable; old adapter publication is non-Draft; old
head cannot satisfy current policy. Strict synthetic paginated REST + local bare
Git fixtures prove multiple identities, duplicate/edit ordering, exact head, stale
head, changed policy, malformed records, denied permissions, timeout and replay.
Actual source card/API and browser interactions prove PR scan/config/template
save and clear missing/held/error states. No fake human/vendor review-quality
claim. Source fixtures cite official GitHub REST reviews, review comments, issue
comments and checks shapes. Upgrade tests retain old history and fail closed for
missing/malformed/unbound policy descriptors. Root owns independent reviews,
integrated full tests and any actual named-sandbox write acceptance.

## Low-battery checkpoint — initial slice only

Implemented: grant-bound PR scan, source account/evidence/head evaluation, registered
project-only authenticated desktop scan/save endpoints, actual source-pinned
coding graph template without merge edges, and an editable guide for choosing
required/advisory account IDs and saving the policy. Saving uses actual Defs
create/version APIs and a signed local confirmation record. No Task starts.
The source admission guard refuses this draft template before allocation because
coding/review wait runtime integration is NOT COMPLETE. This is not a claim that
the full requested workflow can run. Template save/API/UI integration tests and
independent review are still pending; scanner has 15 passing offline assertions.
Draft template creation probe passed schema validation, 26 nodes and 57 edges.

Remaining required before activation: actual captain-authorized Draft publication,
head-bound persisted review wait/fix loop and required CI, model/skill admission,
recovery/upgrade tests, actual UI tests, and repository/organization contribution,
PR/issue template discovery with correct precedence and source-hash-bound body.
Multiple source templates require explicit choice; missing required fields HOLD.
No organization template rule or arbitrary repository instruction grants tools,
network, secrets or publication authority. No real PR/company body is committed.

Authenticated native endpoint integration now passes 23 offline assertions,
including scan/save/no Task allocation/disabled-before-network. Reviewer-discovered
mutable wait-node bypass is reproduced through actual edit/save/start (EXIT1),
then blocked by a signed persistent draft capability and immutable source lineage
across later editable versions. Existing evidence file (including malformed)
always holds; no historical approval is fabricated. Recovery checks also refuse
resumed draft execution. This is a safety hold, not runtime completion.

## Community source slice

Additional exact paths: `src/domain/github-community.ts` and
`tests/github-community.ts`. The adapter only reads fixed contribution/template
paths at an actual default-branch commit. Repository reads use the approved
repository credential; account `.github` fallback is strictly public and anonymous.
404 means absent; 403, malformed snapshots, redirects and timeouts remain errors.
Discovery has a 20-second total deadline, 80 content requests, 128 KiB per file
and 1 MiB total source bytes. Git blob SHA and SHA256 are verified. Symlinks,
escaped paths, arbitrary URLs and oversized template directories fail closed.

Precedence follows GitHub: `.github` before root before `docs`, per file type;
repository issue folder/config replaces the entire account issue folder. No local
PR template means public account defaults may supply the default plus explicit
multiple-template choices. Every chosen source is repository/commit/path/blob
bound. The native save endpoint freshly rediscovers sources, requires a literal
selected template plus captain-supplied title/body and explicit required-input
confirmation, and stores the exact publication draft/snapshot in its signed
private policy record. It never posts that draft. The UI does not tick test,
security, mobile or leader checkboxes. Natural-language required inputs are not
claimed to be a machine-parsed formal schema; captain discussion remains needed.
Contribution text/AGENTS never expands tools or authority.

Primary contracts:
- https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file
- https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository
- https://docs.github.com/en/rest/pulls/reviews
- https://docs.github.com/en/rest/pulls/comments

Validation checkpoint: `bun run test:github-review-workflow` passes 23 native
scanner/API/save assertions plus 12 strict community-fixture assertions. UI source
passes syntax validation; actual browser interaction and independent reviews are
not yet complete. The source execution HOLD remains mandatory.

Latest source checkpoint: contribution snapshot digest is required in the explicit
publication draft request, so changed contribution guidance between display and
save cannot be silently adopted. Actual UI fixture now exercises the native
scan/save handlers, two anonymous reviewer identities, required-policy selection,
source-bound body fields and navigation to the saved graph. One owned browser,
1440/390 light/dark: 21 assertions pass; four material PNGs are under
`tests/out/github-review-workflow/`. This mounts production guide source against
actual native handlers in an isolated fixture shell, not a full-app/server-auth
acceptance or external-provider quality proof. Runtime remains draft-only.

Typed publication slice: `GitHubPrAdapter.open` now supports only an explicitly
true optional Draft flag. Legacy requests omit it and retain their existing
behavior. The strict POST allowlist admits no other boolean/extra body fields.
Existing non-Draft PRs cannot be adopted or converted by a Draft request. Local
bare Git plus strict REST fixtures prove the exact pushed head and actual Draft
record. Original behavior fails that assertion; fixed focused tests pass 27
native/API/publication plus 13 community assertions, and the existing GitHub
foundation regression passes 72. No live publication occurred. Source-owned
publication captain card / policy / workflow runtime integration is still pending;
the initial template execution HOLD remains in force.

Read-only wait foundation (not yet wired to Engine execution): versioned target,
full grant identity, immutable policy hash and absolute original deadline validate
before registration. Two subscribers share the existing GitHubPoller repository
owner and coalesce actual same-target review transport. Cancellation aborts/drains
owned client reads and removes subscribers/timers; a released late held response
emits no approval/findings. Restart-equivalent expired descriptors stop without
renewing their budget. Changed PR head is detected before unrelated check reads.
Formal non-pending reviews require a valid submission timestamp. Final focused
native/API/publication/wait tests pass 37, community tests 13, build passes.

Retained failures: initial changed-head wait test exposed unavailable old-head
checks masking head drift and is fixed by an explicit typed moved-target result.
One earlier combined run failed the local Draft push's 1-second fixture timeout;
its root cause was not established. The local Git proof now declares a 5-second
budget (production defaults to 15 seconds); the original failure log is retained
at `/tmp/github-review-wait-fixed.log`. This is not a claim that a retry diagnosed
scheduler load. Production process timeout/cleanup behavior was not weakened.

Execution integration WIP checkpoint: source-private code bridge now prepares the
literal configured title/body and raises a captain-only Draft publication card
bound to exact repository/base/branch/head, contribution digest and reviewer
policy. Actual signed card-answer records are required before the adapter may
publish. Legacy code publication remains unchanged (72 regression assertions).
Build passes. This new bridge has not yet completed its actual Engine acceptance;
RUN remains held and no external publication occurred. Next step is the integrated
role/admission + external review/fix loop and final ready verification.

Engine integration WIP continues: source-lineage GitHub templates now inherit
native code role/model/skill admission and Firstmate staffing lookup. The source
coding bridge prepares captain Draft publication; the Engine external handler
binds the actual newly published PR number (not the discovery PR), grant, head,
policy and persisted absolute deadline. Required reviewer findings are recorded
as blocking check findings for the existing same-Task refine loop. A final ready
hook freshly rechecks required reviewer votes, authoritative CI and all six gates.
The template removes `remote.ready` (which expects non-Draft/CLEAN merge behavior),
contains no merge action, and has an explicit close route. Initial topology test
caught an orphan Closed entry; the real schema validation now passes.

Activation remains blocked: the complete actual Engine journey has not yet been
validated, and real external staffing identity requires the separate verified
project-execution authority seam currently unavailable on this baseline. Never
replace that seam with a permissive stub. Current focused 37+13 safety regressions
pass; this is not full-runtime acceptance. No paid or real GitHub write occurred.
