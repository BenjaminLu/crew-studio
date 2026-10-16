# Claude native capability — implementation contract

Baseline a54c3167a4b308a502f40005acbe0b8e8bdc04ba. Root ACKed exact scope and Claude-only admission policy before production edits.

Installed CLI 2.1.299 supports print/stream-json, effort, restricted mode, strict MCP config, settings sources, permission-prompts none and no-session-persistence. Official auth documentation states bare mode ignores OAuth, so it must not be used with the existing subscription credential. Passive auth status reports local authentication state; it is not proof of a successful model request. No documented passive CLI model catalog/remaining-quota RPC is available. Do not invent one, scrape interactive sessions, refresh credentials, change billing or read unrelated sessions.

## Admission

Preserve selected Claude model/effort from existing explicit settings, role picks and environment precedence. Exact identities only: no aliases resolved by assumption, no default model substitution, no fallback added. Only an explicit authenticated desktop Verify may make a paid/model request. Metadata, staffing questions, Doctor and ordinary admission never start automatic probes. A source-owned bounded tool-free execution may verify the exact selected canonical model using official stream identity/usage fields; init identity and successful final result must agree, no tool calls or auth/rate/spend denials may occur, and the owned process must exit successfully and be verified stopped before a receipt exists. Effort is an explicit approved CLI/config binding, not an invented backend telemetry fact. Unknown actual identity or unsupported effort holds.

Quota remains unknown when passive remaining balance cannot be measured. A dedicated Claude-only source-branded ephemeral execution-admission receipt may admit this exact auth/model/effort pair for a short freshness window; this is permission to attempt bounded work after an actual successful request, not a remaining-balance guarantee. Generic providers and Codex continue requiring their existing evidence. Unbranded/copied/stale/wrong-provider/wrong-model/wrong-effort receipts cannot admit. Missing auth, unknown capability and unknown model never silently change vendor. Runtime auth/rate-limit/spend/model-mismatch events immediately invalidate matching captured readiness.

Capture credentials once using the existing resolver in a new non-recording mode; keep values private in source closures and feed the same snapshot into the actual provider disposable-home login. Public capabilities contain no credential, source config, email, login JSON or hash that identifies a secret. Preserve Chrome unrelated state; no login/setup-token/auth replacement or original config writes. Existing round OS sandbox, egress and MCP allowlist remain.

Canary: only when existing credential isolation succeeds, exact already-configured model/effort, one fresh tool-free turn, <=120s subprocess and <=150s host deadline, isolated HOME/config/cwd/tmp, no built-in/shell/web/agent/MCP tools, no original CLAUDE.md/plugins/settings, no persistence, verified group cleanup. No automatic second attempt after failure. Otherwise record truthful missing-auth/unverified HOLD.

## ACKed paths

New src/providers/claude-native.ts; src/providers/claude.ts; src/providers/needs.ts; src/providers/login.ts (optional non-recording read only, old defaults preserved); src/providers/policy.ts; src/server.ts; new tests/claude-native-capability.ts; new tests/fixture/claude-native.mjs; package.json owning alias/ordinary-chain inclusion; new docs/units/claude-native-capability.md; docs/architecture.md. Additional ACKed paths: public/ootb.js, tests/ootb.ts; src/providers/proc.ts optional requireSuccessfulExit, enabled only for native Claude. Default process behavior and generic Engine remain unchanged. No dependencies added.

## Verification

Strict actual subprocess fixtures own CLI argv/environment and output schema. Negative controls include missing credentials, auth false/unknown/malformed, wrong provider, unsupported CLI/flags, unknown/mismatched model/effort, missing/denied rate facts, successful result with errors, API-spend/usage denial, invalidation after captured success, forged/copied receipt, stale receipt, revoked owner, cancellation, timeout and verified cleanup. Positive fixture receipt admits exact pair only; fixture proof cannot certify installed vendor identity. Existing vendor-policy/secret-registry/credential/provider suites remain owning regressions. Staffing facts preserve original opaque capability reference to verifier and continue displaying quota unknown.

## Current actual diagnosis

Captain reports the machine account is logged in with exhausted quota. Both installed CLI paths (2.1.299) report loggedIn=false/authMethod=none in this Studio process context. These are different observations; the latter does not describe unrelated Terminal sessions or prove global logout. No actual model canary has run. No authentication change, paid canary or exhaustion retry is authorized. Doctor explicitly distinguishes binary detection, context authentication and quota; unknown reset time remains unknown.

The explicit desktop Verify route is implemented, but there is no Verify UI in this unit. It is never invoked by metadata/Doctor/staffing reads. Its source-owned execution receipt lasts 30 seconds and preserves the original capability object privately; serialized facts cannot reproduce authority. Actual worker terminal success is withheld until successful exit and bounded process-group death verification. Unknown cleanup invalidates admission and holds later attempts.

Offline evidence: capability subprocess fixtures 35/0 (including success+exit1, missing result and cancellation); Doctor renderer 65/0; vendor policy20/0, native-policy-r2 19/0, credentials8/0, secret registry66/0. These do not establish vendor acceptance. The baseline a54 policy actually rejects the successful source receipt because quota is unknown; retained fail-first is the real policy branch, not a module/setup error. No browser/design assessment or full suite is claimed.

## Primary sources

https://code.claude.com/docs/en/cli-reference
https://code.claude.com/docs/en/authentication
https://code.claude.com/docs/en/model-config
https://code.claude.com/docs/en/costs
https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md

## R2 receipt replacement contract

A successful Verify supersedes and revokes every previous receipt for the same selected pair before publishing its replacement. Old provider objects must refuse before CLI launch. Runtime denial still invalidates all currently admitted receipts owned by the controller. Offline two-Verify controls cover old and replacement objects, actual runtime quota denial, and authentication/model denial signals; no live quota retry is authorized.

Retained R2 evidence: unchanged d895 source with the new two-Verify assertion exits 1; fixed owning subprocess suite passes 41/0. Provider-policy alias and build exit 0. Fixtures are offline and do not establish real account/model acceptance.

## Personal workflow bounded refresh

The final Run staffing dialog includes an exact Claude model/effort grant for each personal-workflow agent node: at most one verification request, one turn and USD 0.05 per node. Work itself remains separate. Server validation matches the immutable saved definition and full staffing plan; client params and metadata cannot grant paid authority. A signed grant is written before the Task starts. A consumed attempt is signed before the verifier runs, and is never refunded on failure, cancellation or restart. Verification preserves unknown quota and never changes the selected provider.

A historical Task with no grant stays on its readiness card without probing. The desktop captain can choose “Authorize Claude verification and continue” on that Task. Its confirmation binds the original definition, current node, visit, attempt, head and open readiness card. Each card accepts only one grant. Confirmation answers the existing preparation card and resumes the same Task; it does not regenerate the workflow or copy its history. A consumed allowance needs another explicit captain confirmation on a later readiness card.

`bun run test:own-claude-refresh` uses only offline CLI fixtures. Unit coverage includes exact-pair/definition/owner checks, parallel spending, failed consumption, replay, stale and repeated confirmations, phone refusal and metadata isolation. The real browser covers final Run disclosure through native delivery and a restarted historical Task through explicit same-Task recovery. This establishes application behavior, not live account quota or vendor availability.
