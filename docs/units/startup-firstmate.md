# Native launch and one Firstmate entry — implementation contract (ACKed)

Baseline: 64fd413d5fd51d61627fc4aa137c333b876adfe7 (reviewed independent Codex account and effective main-host identity). No production edits, browser launches, login, model turns, PATH installation, or live data changes were made for this proposal.

## Observed failures

- `crew-studio` is not on this machine's PATH. Documentation requires a running server plus a second-terminal open command.
- Source defaults to checkout/data; compiled binaries default to ~/.crew-studio/data. The opener independently selects its own store and calls sessionToken, which can create an unrelated token. Live custom CREW_DATA is not discovered.
- macOS open returning zero proves dispatch acceptance, not a visible normal browser window. Existing messaging claims more.
- Session cookies are host-only: localhost and 127.0.0.1 split authentication. The opener uses 127 but the shell accepts both.
- m25.js defaults to a read-only Status conversation and presents Firstmate as a competing second tab.
- app.js T(en,tw), L and zh currently recognize only English and Traditional Chinese. scard.js has a separate two-language implementation. The lower-left language selector is in index.html; Settings is owned by backbone.js.

## Required vertical slice

One supported relative command (`bun run launch` during development; `./crew-studio launch` for the binary), or a neighboring double-click macOS launcher, starts or finds Studio and requests opening its authenticated Board. No preexisting terminal session, copied session link, second terminal, or PATH setup is required. The launcher must report browser dispatch truthfully; a visible-window claim needs separate actual browser evidence.

The Board's single primary Firstmate conversation shows an explicit Connect Codex action when needed. Only the captain click starts official browser login. Existing verified accounts can continue through the same effective vendor model/effort validation as 64fd. Studio then offers creating its own fresh primary session, showing the exact project context; it never discovers or resumes an existing terminal session implicitly. Existing Studio-owned busy sessions and project coordination locks remain authoritative. Missing tools, unavailable accounts or occupied project contexts produce guided holds. This main-host readiness is not native Engine provider readiness.

Read-only status remains available as secondary Activity/context, with its authority unchanged and no second conversational bot label. Existing-session takeover remains an explicitly secondary advanced action.

The landing worker proposes the stable existing-route entry `#/workflows/coffee-kit` (definition/UI not yet implemented). After a primary session becomes ready, navigate once to that entry; do not auto-start an Engine Task. Template copying and brief/direction submission remain explicit authenticated actions, and native admission remains independent. Persist an idempotent onboarding state bound to the active Studio primary session; reload must not create another thread or replay a starting message. No guessed coffee API, seed, workflow or project authority is introduced before that contract is confirmed.

## Secure running-instance authority

Introduce a private per-user runtime directory shared by source and compiled entrypoints, with owned regular 0600 instance/credential files under a 0700 directory. An instance record contains schema, PID, canonical 127 origin, data directory, boot identity and launch protocol version. The separate ephemeral launch credential is the server's existing SESSION value, including when sourced from CREW_SESSION_TOKEN; it never changes the authoritative token or original environment. It is not returned by an unauthenticated HTTP endpoint.

A local opener validates file ownership/modes, no symlinks, loopback origin, a live PID and a bounded server boot-identity response before handing a credential to a browser. Ambiguous targets, legacy servers without a matching record, stale records and mismatched ports fail closed with safe instructions. Explicit data selection must match exactly. Merely finding a process or an HTTP server is insufficient. The opener never creates a session token. Cleanup removes only its own boot record/credential. Do not print session URLs on failure or put credentials in durable logs/events.

The launch subcommand starts an owned in-process server if none matches and waits for readiness before browser dispatch; preserve ordinary serve behavior. No unowned background service or global install. A relative macOS .command wrapper locates its neighboring binary, including paths with spaces. Browser selection retains explicit --browser and existing system default handling, without changing defaults or profiles. A successful open command is described as requested, not confirmed visible.

Canonicalize local localhost/[::1] navigation to 127 before cookie issuance, respecting existing host/origin guards and remote/phone routes. Do not turn an unauthenticated page into a session grant.

## Proposed implementation scope (needs ACK)

Production: src/main.ts; src/open.ts; NEW src/instance.ts; src/server.ts; scripts/build.ts; package.json; public/m25.js; public/takeover.js; public/takeover.css; public/backbone.js; public/index.html. Keep src/host/main.ts identity enforcement and providers unchanged. src/default-browser.ts and src/csrf.ts should remain unchanged unless a concrete test demonstrates a necessary seam.

Tests: tests/open.ts; NEW tests/launch.ts; NEW tests/lib/launch-fixture.ts; tests/backbone-ui.mjs; tests/takeover-codex-ui.mjs; tests/codex-independent-login.ts. Documentation: this file, README.md, docs/setup-and-reference.md, docs/architecture.md. Coffee integration paths remain pending the landing worker's concrete entry contract; request that narrow scope before editing.

## Locale: separate bounded companion unit

Settings becomes the sole global language selector: English, 繁體中文, 简体中文. First visit resolves browser languages (zh-TW/HK/Hant to zh-TW, zh-CN/SG/Hans to zh-CN, otherwise en), then persists only manual preference; an existing explicit preference wins. Remove lower-left global picker. Card-local content controls must follow the selected global locale or remain clearly local; do not leave a second global chooser disguised inside a card.

A shared locale module must serve app.js and independent scard.js. Keep existing T(en,tw) call sites compatible through an explicitly reviewed Simplified string catalog keyed by exact source strings; allow explicit third argument for different wording. Do not claim a language-label change or blanket character conversion is complete localization. Dynamic bilingual content uses a documented zh-CN projection/fallback with visible untranslated handling where source text is unavailable, never relabel English as translated. Date/number formatting uses selected locale. Inventory every public source and material state before claiming full Simplified coverage; add literal-string coverage checks and actual rendered assertions.

Exact proposed companion paths: NEW public/locale.js; NEW public/locale-zh-CN.js; public/app.js; public/scard.js; public/takeover.js; public/backbone.js; public/index.html; public/kit.js only if script-export wiring requires it; scripts/gen-assets.ts only if asset discovery is not automatic; NEW tests/locale.ts; NEW tests/locale-ui.mjs; tests/backbone-ui.mjs; package.json; this unit doc. If inventory finds direct two-language assumptions elsewhere, enumerate those exact paths before implementation; do not silently widen scope or declare shell-only coverage to be full UI support.

## Observable acceptance and fail-first controls

Use actual local server fixtures and fake OS-open executables, not a mocked session endpoint. Prove custom live store beats source/binary defaults; env-only token works without token creation; stale PID/nonce/occupied port/ambiguous instances cannot receive credentials; all failure output is secret-free; unauthenticated pages cannot grant sessions; localhost canonicalization obtains the proper host cookie. Launch-when-running reuses the exact instance; launch-when-stopped owns startup and shutdown. Relative launcher works with spaces and no installed command. Open exit zero produces only truthful requested messaging.

Actual authenticated UI must show Board → explicit account action → verified effective identity → fresh Studio primary → coffee entry, with zero terminal discovery requirement and no duplicate threads after reload. Preserve existing takeover, guard-write, main ownership and independent login negatives. Test English/Traditional/Simplified, 390/1440, light/dark; inspect material screenshots and genuine keyboard/focus behavior. Actual visible browser opening is a later captain-approved desktop smoke, not inferred from headless fixtures. No worker full suite; root owns combined reviews and authoritative full acceptance.

## Captain amendment: native Firstmate context

Default fresh startup uses only Studio's own data/workspace; no source checkout, task target, firstmate-workflow repo, HANDOFF or preexisting terminal is required or inferred. An explicit CREW_MAIN_PROJECT or explicit legacy adapter is labeled as such and keeps its coordination rules. Native bootstrap describes Studio workflow drafting and captain-confirmed execution; it must not tell the new host to run legacy dispatch scripts. Reviewed actual model/effort pre-seed admission stays intact. Additional approved paths: src/host/main.ts, src/takeover.ts, tests/host.ts, tests/takeover-codex.ts. Coffee ready navigation targets the landing worker's #/workflows/coffee-kit without automatic Task creation.

## Priority checkpoint and native tools scope

Locale work is paused at /private/tmp/crew-studio-startup-locale-checkpoint and is excluded from the current implementation candidate. No complete localization claim is made. Captain prioritized the launch → authenticated own Firstmate → native dispatch card vertical slice. No browser launches, including headless fixtures, are permitted yet.

ACKed native bridge additions: src/host/types.ts, src/host/codex.ts, src/firstmate.ts, src/runtime/index.ts, workflows/v2/firstmate-proposal.wf.yaml, tests/firstmate-native.ts, tests/fixture/codex-account.mjs. Selected protocol fixture/generator may change only if required by the experimental dynamicTools field. Public official app-server docs and installed 0.162.1 --experimental schema establish the field; model/effort/approval/sandbox selection remains untouched.

Only a fresh Studio-owned primary advertises list_workflows, authorized project/status reads, and propose_work. Unknown dynamic tools remain denied. Native proposals must be bound to the owned live captain-input thread/turn/generation, not bootstrap or background messages. The trusted server holds native APIs and credentials; model receives no session token, generic URL, shell, grant or answer capability. A proposal becomes a real source-owned workflow captain card, pinned to exact target workflow version/params. Only its actual captain answer may start work through existing engine admission. Persisted proposal identity/child run binding must prevent duplicate work across restart, cancellation and retries. No dependency on external engine paths, AGENTS or legacy scripts.

Approved additional src/self.ts unifies the default store at ~/.crew-studio/data. Explicit stores are retained and never migrated. Locale remains paused/excluded. UI startup Connect intent is transient and project-bound; passive ready events or reload cannot create a new primary. Continue explicitly starts the fresh primary and navigates to coffee-kit without allocating workflow work.

## Current evidence and limits

Native actual server/app-server fixture/Engine19/0, plus real Engine cancellation/project drift/definition pin/idempotency controls8/0 (27/0 total) passed before final freeze. No actual vendor quality/perception claim: the app-server is offline and target starter has no agent/browser. Retained initial native failures include missing source metadata normalization and stopping during card presentation; corrected source/pending-state barrier is explicitly tested. Native firstmate tools require installed0.162.1 experimental dynamicTools; [official app-server documentation](https://learn.chatgpt.com/docs/app-server) and generated local experimental schema are the interface evidence. No model/effort/approval/sandbox override is added.

Locale is not shipped in this slice. No browser, headless browser or new screenshots ran: captain explicitly paused all Chrome launches. UI/visible-browser/coffee integration acceptance remains root-owned and cannot be inferred from server/source checks. Existing actual immutable minimal fresh-cutover fix02a0d6a is retained identically in the broader public/takeover.js hunk.

Generated src/bundled.gen.ts is approved scope: build embeds the new source-owned proposal workflow; no handwritten generated logic. Final backend focused evidence: native27/0, launch16/0, runtime56/0, authority9/0, host64/0, takeover60/0, independent account34/0, open11/0, build EXIT0. Logs: /tmp/v2-startup-{native-final,launch-final,runtime,authority,host,takeover,account,open,build}.log with adjacent .exit files. Browser-free new/default launcher fail-first against frozen64fd retains EXIT1; native actual behavioral fail-first1/3 EXIT1. No full suite or independent approval is claimed.

## R2: material dispatch target visibility

Preserve0291532 immutable. Shared plain captain-card rendering does not display sections.scope; therefore the native dispatch body must itself visibly identify exact target workflow/version, parameters and captain-only execution intent in English and Traditional Chinese. src/firstmate.ts and tests/firstmate-native.ts remediate within existing scope. Actual card-body owning fail-first on029:27passed/1failed EXIT1 retained at /tmp/v2-startup-card-target-failfirst.log/.exit. No shared card renderer or locale expansion is needed.

Single-primary UI also hides the old read-only provider selector and local-status-cache clear control in main mode (public/m25.js existing approved scope): neither controls the vendor-owned primary identity/history. Native tool links use the actual #/run/<id> route.

Native success UI uses Primary session/Stop Firstmate, hides legacy handoff/copy/resume instructions, and explains native proposal semantics. Explicit legacy contexts keep their existing controls. No terminal is required merely to stop or use Studio’s own primary. This is existing approved public/m25.js/public/takeover.js scope, not a legacy backend behavior change.

Native primary chat omits the bootstrap system prompt from captain bubbles and uses the one existing chat composer for proposals. The duplicate legacy dispatch form stays only in explicit legacy contexts. Bootstrap audit/transport is preserved; no backend prompt or tool authority is weakened.

Owning UI coverage uses already-approved tests/backbone-ui.mjs with explicit STARTUP_FIRSTMATE_UI mode; existing backbone assertions remain intact. One package test:startup-ui alias and main-chain invocation retain the new regression. No new UI source path is introduced. Captain cleared one bounded owned headless fixture launch after source freeze, with private HOME/profile, actual isolated APIs and synthetic account/app-server only.

## R3: reconcile account state across stream establishment/reconnect

Preservebc4e270 and its failed UI51/1 EXIT1 with18partial frames (no crash). Actual two-subscriber HTTP control confirms the server publishes pending account events to established subscribers. The client lacked crew:live/reconnect reconciliation and revision-bound initial reads. Existing public/takeover.js scope adds GET-only refresh, newest-read/revision ownership and no passive primary/login actions. Owning tests/backbone-ui.mjs adds browser-free actual-module callback controls and a real S.conn=live fixture barrier, with safe connection/account diagnostics. No blanket timeout retry or stale-state pass.

The offline app-server fixture now exits on its owned stdio EOF (including its synthetic callback listener); the UI harness verifies every recorded fixture PID has exited after cleanup. This is fixture lifecycle correction, not a production host or user process teardown change.

## R4: Board welcome participates in material live updates

Preserve de263385 and its52/1 UI failure. A subsequent actual-browser diagnostic received both checking and pending codex-account events in all eight contexts, while seven Board DOMs stayed unknown. The Board's soft() signature omitted the newly mounted welcome, suppressing a legitimate redraw. Root ACKed narrow additional public/board.js scope: include a bounded source-owned welcome signature, preserving unchanged-state suppression and existing focus protection. Existing approved public/takeover.js supplies account/load revisions and primary state/project identity; public/m25.js routes primary state events through soft() on Board. No account URL, credential, log or raw payload enters the signature. Owning tests/backbone-ui.mjs actual-source fail-first is7/1 EXIT1 at /tmp/v2-startup-board-signature-failfirst.log/.exit. The diagnostic leaves same-origin requests un-intercepted, records real SSE state receipts and never injects events.

R4 evidence before repair: /tmp/v2-startup-firstmate-r4-network-diagnostic.log/.exit records52/1 EXIT1,18partial frames and real checking/pending receipt arrays in all eight browser contexts. No page errors/crashes; recorded fixture PIDs all exited. Removing same-origin request interception did not fix the failure, so it is not claimed as the cause. A preceding normal-sandbox attempt stopped on loopback EPERM before browser launch (/tmp/v2-startup-firstmate-r4-diagnostic.log/.exit); the authorized offline fixture ran with explicit loopback permission. Previous R2/R3 UI failures remain historical failures, not acceptance evidence.

Root resumed and ACKed R4 material-signature remediation. Source uses a bounded welcome signature (account/load revisions and primary identity), not account URL/credential/log data; main events enter existing Board soft() so its focus guard remains authoritative.

R4 first repaired UI progressed214 assertions then correctly refused a pointer click because the fixture left the real chat drawer open over the captain action. Retain /tmp/v2-startup-firstmate-r4-green-ui.log/.exit (214/1). The owning fixture now explicitly closes that drawer via its real UI control before reviewing the card, and asserts elementFromPoint hit ownership for each material approval button; no force click or synthetic answer.

The next actual run retained221/5 EXIT1: four phone hit-tests exposed the live new-card cue over the bottom action, and final Board capture encountered a legitimately replaced heading during scroll. The fixture now follows the actual cue Show link (which consumes/dismisses that cue) before reviewing the card, rather than navigating behind an unconsumed notification. Frame scrolling uses the atomic DOM scrollIntoView on the current locator, then independently measures current geometry; no force clicks or hidden controls. All prior negative hit-test frames remain retained.

R4 subsequent240/2 run completed every account, primary, native-tool, captain-approval, one-child and cleanup assertion, with all eight approval actions unobstructed. Two final Board heading measurements raced a genuine live card refresh (retained PNGs show the heading); capture readiness now waits for the current DOM material target to fit the unchanged exact viewport threshold, scrolling only through normal DOM scrolling. Timeout remains a failure; no capture is counted without actual geometry.

R5 capture-only refinement preserves764e55b frozen. Its exact UI240/2 log proved all functional actions but two phone buttons met browser viewport coordinates while clipped by the main scrollport. Capture readiness now intersects actual overflow-clipping ancestor bounds and invokes normal scrollIntoView until the entire target is inside that visible intersection. Existing hit tests remain required. No production/public byte changes; final evidence will be source-equivalent to764e55b.

## R2 independent native Stop (review closed-list remediation)

Preserve frozen0e01de5. Exact ACKed scope: src/host/main.ts, public/m25.js, tests/firstmate-native.ts, tests/backbone-ui.mjs and this unitdoc. Native fresh primary Stop releases owned host/permissions/lock with holder none, no resume command, truthful stopped status and no invented terminal ownership. Existing actual takeover/explicit-project releases remain unchanged. Preserve historical records; do not rewrite logs. Native fresh handoff/restart messaging must not introduce terminal continuation authority. Actual API+UI regression must stop primary, leave dispatched child identity/work intact, show fresh-start control, and capture stopped state across390/1440 light/dark EN/zh-TW.

Additional necessary endpoint scope requested before edits: src/server.ts /api/main/detach currently returns409 for any null command. A successful own-native Stop intentionally has no command and requires200 {stopped:true,resume:null}, bound to an actually attached native fresh primary and confirmed detached holder:none. Legacy nonempty resume response and genuine no-session409 remain unchanged. Actual API fail-first30/2 and actual renderer fail-first9/1 retained at /tmp/v2-startup-native-stop-failfirst.log/.exit and /tmp/v2-startup-stop-renderer-failfirst.log/.exit; current renderer10/0 at /tmp/v2-startup-stop-renderer-green.log/.exit.

Root ACKed the narrow src/server.ts endpoint addition. Native success200 is bound to the actual prior native fresh attached/paused state and confirmed detached holder:none, no resume; otherwise genuine absence remains409 and legacy nonempty command response remains unchanged. Legacy host64/0 and takeover60/0 regressions passed after host remediation.

Fixture correction before final evidence: the first API Stop assertion followed the pre-existing restart test, so no primary was attached; its30/2 failure does not prove the Stop defect and is retained as invalid-control evidence. The corrected fixture explicitly creates and verifies a genuinely attached primary before Stop, and separately proves a second no-session call409. NATIVE_STOP_BASELINE_ROOT selects old server source while retaining every current fixture assertion; genuine corrected old/control and final exits are recorded separately.

Corrected actual owning fail-first against immutable0e01de5:32/2 EXIT1 at /tmp/v2-startup-native-stop-owned-failfirst.log/.exit (attached-primary control passed). Fixed actual API/host/card/Engine regression34/0 EXIT0 at /tmp/v2-startup-native-stop-owned-green.log/.exit. Actual detached renderer old9/1→new10/0; explicit-project guidance remains positive-controlled. Existing legacy host64/0 and takeover60/0 passed. Final frozen UI must additionally capture all eight post-Stop states and assert explicit fresh-start availability plus independently dispatched child identity, with no user/vendor changes.

Capture-only R3 preserves frozen455e074. Exact UI245/1 proved actual Stop, holder:none, no resume and child preserved, then fixture attempted to open chat already open after same-hash navigation. Post-Stop capture now opens chat only when the actual body is chat-closed; no force clicks, synthetic state or production changes. Final successor source/public bytes remain equivalent to455e074.
