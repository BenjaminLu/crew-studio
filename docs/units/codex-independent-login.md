# Independent Codex browser login and fresh firstmate

Status: implemented; current remediation awaits independent review and final acceptance. The original proposal followed the C3 actual native canary. Base1420bdf (timestamp fix independently code-approved). D1a R2 remains safely paused elsewhere.

## Existing behavior and gap

src/doctor.ts LOGINS.codex and /api/doctor/login currently run codex login as an installer job, without a first-class correlated account state/browser-login completion/model-quota lifecycle. src/host/main.ts startFresh already uses a new thread/start without an original thread ID, but /api/takeover performs discovery before rendering, so failed/empty terminal discovery is coupled to entry. Its fresh-start dialog unnecessarily instructs the captain to close a terminal. These do not establish a complete Studio-native sign-in-to-fresh-work flow.

The requirement is: in v2 choose Connect Codex, complete the official browser ceremony, verify account/model/quota, start an independent firstmate thread and task, without selecting, taking over, resuming or requiring any terminal session. Optional takeover remains explicit and separate. Copying existing credentials alone is not acceptance.

Official source fetched2026-10-15: https://learn.chatgpt.com/docs/app-server sections account/login/start (type:chatgpt), login/completed, account/updated, account/login/cancel; app-server owns browser callback. Minimal stable public fields must also agree with installed0.162.1 protocol fixture. No chatgptAuthTokens/internal/external token shortcut, API-key switch, subscription switch, fabricated login completion or automatic model fallback.

## Proposed exact scope (requires parent ACK before implementation)

Production:
- src/host/codex-account.ts (new): bounded owned public account/login RPC controller; structured sanitized readiness, notification correlation, cancel/exit/shutdown cleanup.
- src/host/jsonl.ts: only if necessary for verified owned process close/drain/cancellation used by the new controller; no generic protocol or command authority.
- src/server.ts: desktop authenticated write endpoints and shutdown owner; expose only typed status/start/cancel. Existing CSRF/session checks preserved. Doctor Codex login delegates to this controller instead of installer capture.
- src/doctor.ts: distinguish installed/authenticated/verified-ready and tool health; actions connect/retry/cancel. No CLI-equals-health claim.
- src/takeover.ts: fresh entry/status independent of discovery failure; gate readiness before independent start, no caller-controlled RPC/path/model/auth-home.
- public/ootb.js: Codex Connect browser link/pending/cancel/failure/readiness states.
- public/takeover.js: primary Connect/Start-new entry without terminal selection; optional session history/takeover stays secondary; fresh confirmation states same-state ownership only.
- public/takeover.css: only actual new control layout/phone clearance if necessary, preserving existing typography/theme.
Tests/docs:
- tests/codex-independent-login.ts (new): actual production controller/server and strict fake app-server, no real credentials/browser login.
- tests/codex-independent-login-ui.mjs (new): authenticated actual server/page login-to-fresh flow and matrix.
- tests/fixture/codex-account.mjs (new): strict installed-protocol dummy rejects unknown RPC/params, controllable matching/mismatching completion, busy/exit/delay; fixture home only.
- tests/ootb.mjs: narrow existing Doctor fixture expectations if changed.
- package.json: one owning alias/main-chain registration for each new suite.
- docs/architecture.md and this unit document: source of truth for ownership/capability and limitations.

No host model/sandbox/approval override, no provider capability weakening, no native Designer CLI bypass. src/providers/login.ts remains exactly reviewed1420; round auth handoff continues to exclude refresh credentials. No project grant, remote, queue gate or D1a edits.

## Authority and lifecycle

The app-server uses the captain-selected standard CODEX_HOME (or vendor default), like the existing official login command, so the captain's explicit browser action may update vendor-managed login there. No app-level token extraction or credential-copy ceremony is presented as login; no raw tokens enter APIs, event stream, logs, cards or snapshots. Tests force a disposable CODEX_HOME. Real login writes occur only through the actual captain Connect/browser ceremony, after independent review/deployment; offline tests never invoke real login.

Exactly one owned login attempt, correlated loginId and generation; later completion for another/stopped attempt cannot mark success. Start minimal account/login/start {type:chatgpt}; validate returned HTTPS exact official auth host before presenting a link. AuthURL (OAuth state) is ephemeral, private desktop response only, excluded from general events/logs/storage. Popup blocking presents an explicit safe link. Desktop cancel invokes account/login/cancel on the same process/ID then terminates owned callback process; shutdown awaits actual bounded cleanup or reports unresolved. No polling background process, credential side channel or global PID kill.

Matching success is not readiness by itself: account/read(refreshToken:false), bounded model/list and account/rateLimits/read must establish current configured model/effort/quota. Missing/unknown/exhausted remains an explicit hold; no login retry/model fallback without captain action. CLI detection, auth readiness and native repository tool health are distinct facts. Account status can be reverified on explicit refresh and before fresh work. The account controller never starts/forks/resumes a thread. Existing MainSession fresh startup is a separate owned transaction using thread/start, with no originating thread ID and existing permission bridge/config authority unchanged.

Existing vendor account state may be displayed as already authenticated after verified public reads, but the UI still supports an independent browser sign-in ceremony; preexisting terminal session discovery is neither prerequisite nor authorization. Takeover requires its own explicit selected source and confirmation, never implicit during new-start.

## Evidence plan

Behavioral fail-first against1420 actual APIs: zero terminal sessions (and failing thread/list), Connect yields bounded browser ceremony; wrong/stale completion ignored; matching completion plus account/model/quota verified allows fresh thread/start with no source ID; original source never resumed/forked; start failure/retry/cancel/restart produce no leaked callback/app-server or stale ready status. Strict unknown request/URL/host/params refuses, desktop/session auth prevents phone/cross-origin login mutations, raw OAuth/token values absent from durable/public logs.

UI material matrix:390/1440, EN/zh-TW, light/dark for disconnected, pending browser action, verified readiness and independent fresh start; demonstrate optional takeover remains secondary and no terminal row is required. Phone controls reachable/unobscured; actual authenticated DOM/geometry assertions. Preserve existing Doctor/takeover/native regressions. Independent code+designer review and root authoritative full before landing. Real captain browser login and actual independent web fresh-work proof remain explicit final acceptance, not substituted by dummy fixtures or the earlier copied-auth canary.

Implementation scope ACK: tests/ootb.ts replaces nonexistent tests/ootb.mjs; add narrow tests/takeover-codex.ts verified fixture wiring, tests/stub-host-codex.mjs explicit strict synthetic account/model/quota protocol, tests/takeover-codex-ui.mjs only owning old-copy assertions if needed. Existing src/providers/probe-process.ts supplies verified owned teardown unchanged; src/host/jsonl.ts will not be edited. New controller uses the same configured Codex binary as main host (CREW_HOST_CODEX_BIN, then CREW_CODEX_BIN, vendor default), existing standard CODEX_HOME and configured model/effort; no fallback on unavailable auth/quota/model. Studio-owned main state guards all login/new-session acquisition. unrelated terminal discovery does not gate new work.

Additional strict-schema fixture scope ACK: scripts/codex-protocol-fixture.ts and tests/fixture/codex-app-server/protocol.json add the three read-only account/read, model/list, account/rateLimits/read USE definitions from the same installed0.162.1 stable generator; retain strict unknown-method/params/results checks. No production bypass. Existing takeover UI now must explicitly open optional history and verify the synthetic configured account before its independent fresh action; owning fixture edits preserve original takeover/permission/breakpoint assertions.

## Final focused evidence and retained controls

- Genuine final behavioral control on separate unchanged1420 production checkout: /tmp/v2-independent-login-failfirst-final.log/.exit, EXIT1, 1 passed/1 failed. Existing Doctor installer-job response cannot provide the public browser ceremony. Original /tmp/v2-independent-login-failfirst.log0/2 is retained; its additional discovery flag oracle was overly strict and superseded (empty discovery itself already worked on old source).
- Final actual API/controller/subprocess lifecycle: /tmp/v2-independent-login-final.log/.exit EXIT0,22/0. Includes verified fresh thread with no source ID, wrong completion, real cancel/expiry/drain, held account/read cancellation with no late ready, unknown server tool request refusal, configured model mismatch, quota unknown/exhaustion, explicit backend permissionfalse/null, bad official-URL refusal, Studio-owned main guard and sanitized API/log fields.
- Final actual authenticated UI: /tmp/v2-independent-login-ui-exact.log/.exit EXIT0,195/0;48 PNG at tests/out/codex-independent-login. Six states (disconnected, pending, verified, doctor-account, fresh-confirmation, independent-fresh) ×390/1440 ×light/dark ×en/zh-TW. Existing source .set ready remains internal while owned process drains; only after cleanup does public/SSE readiness become ready.
- Existing actual takeover/permission/transition/breakpoint UI: /tmp/v2-independent-login-existing-ui.log/.exit EXIT0,71/0. All original assertions retained, history now explicitly requested and synthetic configured account explicitly verified before fresh action. Existing native takeover/configuration/protocol suite: /tmp/v2-independent-login-takeover.log/.exit EXIT0,60/0. Doctor/out-of-box: /tmp/v2-independent-login-ootb.log/.exit EXIT0,47/0.
- Final build: /tmp/v2-independent-login-build-final.log/.exit EXIT0. Installed stable schema generator source remains0.162.1; all old method lists/use mappings/definitions deep-equal, only three readonly metadata definitions and dependencies added.

Retained failures: initial test server initialization-order error plus fixture cleanup hang ended with actual143; fixed order/exited-child guard. Earlier lifecycle17/1 was a fixture quota encoded as string100 (correctly classified unknown), fixed to actual schema integer100. UI191/4 proved genuine390px modal intrinsic overflow: long exact project path pushed Start offscreen. Narrow scoped minimum-width/word-wrap fix retained old48frames at /tmp/v2-independent-login-ui-r1-captures, final allcontrols reachable. Earlier capture interrupted during a truthful in-flight busy render; final test binds data-account-busy=false, with no sleep/forced layout.

All final owned sessions have ended. No real browser login, account mutation, provider model turn, project/credential/config/remote writes occurred; all vendor/account fixtures use disposable homes and scrub legacy/secrets. Source1420 timestamp fix/native provider/host permission backend and shared scard/styles bytes remain unchanged. No full suite or independent approval claimed. Root owns code/designer review/full and eventual actual captain browser login/fresh-web proof. Claude production and paused D1a work are not included. Coffee-shop onboarding is now highest priority; this dependency freezes and stops new rounds.

## R2 standing review: bind fresh host identity before seed

Frozen rejected control0694f7c remains unchanged. New isolated checkout remediates the single model-namespace/actual-identity class. Main host readiness must use vendor Codex config, not chat settings/native CREW_CODEX_MODEL. Preserve native provider selection separately. Both captured configured identity and actual thread/start result must match, with known verified model/effort, immediately before ANY handoff, driver ownership, queue seed or pump. Unknown/changed/mismatched actual identity fails through the existing whole-startup rollback and leaves zero seeded turn/start calls. No thread/start model/effort overrides.

Original ACK paths: src/server.ts, src/takeover.ts, tests/codex-independent-login.ts and this document. Requested minimal necessary additions: src/host/main.ts optional trusted pre-seed validation callback and tests/fixture/codex-account.mjs exact synthetic catalog-vs-opened-model/effort/config-drift knobs. Parent ACK received for both additions before production changes. Behavioral old-source controls will exercise actual APIs: catalogA with native/chatA but vendorB refuses zero seed; catalogB allows actualB/low despite unrelated native/chatA unavailable; opened-model/effort mismatch and changed vendor config refuse before seed. No real login/auth/config writes; fixture homes only.

R2 evidence collected: /tmp/v2-independent-login-r2-failfirst.log/.exit EXIT1,6passed/6failed on unchanged0694 production plus new synthetic fixture controls; all five unsafe old scenarios actually returned200 and delivered one seed, while valid vendorB was blocked by unrelated nativeA. Fixed /tmp/v2-independent-login-r2-identity.log/.exit EXIT0,12/0. Complete owning suite /tmp/v2-independent-login-r2-focused.log/.exit EXIT0,34/0; existing Codex takeover /tmp/v2-independent-login-r2-takeover.log/.exit EXIT0,60/0; generic host /tmp/v2-independent-login-r2-host.log/.exit EXIT0,64/0; build /tmp/v2-independent-login-r2-build.log/.exit EXIT0. All owned sessions finished.

The optional MainSession validator is trusted synchronous boolean admission, immediately after host attachment, before ANY driver/handoff/seed/pump. Failure uses existing whole-startup rollback. Production takeover always supplies it, binds verified account/model/effort/quota/freshness, rechecks current vendor config and actual opened model/effort. Unknown effort is held instead of invented, and thread/start remains cwd-only. Native/chat configuration and model policy are unchanged. Actual API cases prove no original thread is resumed/forked, no model/effort overrides, and zero seeded turn on refusal.

No public bytes changed from0694: all48material captures in /tmp/v2-codex-independent-login-0694f7c-captures retain exact source equivalence for layout/copy; they are prior visual evidence, not a new full UI execution on this head. Existing timestamp/auth handoff, native provider/policy and Codex host backend also byte-identical. No actual account/login/global-config/remote operations. Root owns exact independent review/full and designer binding. Coffee-shop work remains separate; no board migration or bridge was added.

## R3: fresh success does not imply terminal cutover

Scope: public/takeover.js, tests/takeover-codex-ui.mjs and this document only. The cutover renderer requires an actual owned origin; fresh independent or detached inventory states render none. Real takeover instructions remain bound to that actual origin, never an unrelated discovered session. Browser-free owning tests evaluate the actual renderer for all three cases. Actual browser/captures remain paused by captain instruction; historical fresh-success screenshots are not current visual acceptance. No backend, account, host/config/model, or authority changes.
