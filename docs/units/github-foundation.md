# GitHub foundation (A1 + A2)

Why: code-firstmate currently keeps review requests local; GitHub writes need an explicit project grant and deterministic tests before a captain names a real sandbox.

What: retain the local adapter by default. A trusted project record may opt in with an exact approved GitHub target, push URL, API origin, local repository, base and branch prefix. No UI/API implicitly grants this authority. The adapter may list/read, create and update pull requests only. It cannot post reviews/comments, create repositories/releases, merge or mutate an out-of-prefix branch. Outside-prefix naming requires a later captain card and fails closed here.

Done:
1. A strict local REST simulator backed by a real bare Git repository supports documented PR shapes and explicit fixtures for later checks/status/review/log/merge tests. Unknown routes, verbs, queries and body keys fail.
2. Pushes use an exact force-with-lease and isolated Git configuration; tokens never enter URLs, arguments or persistent config. No unapproved remote is inferred from origin.
3. Open/restart/update preserves PR identity and target, recovers partial success idempotently, validates returned head/base/repository, and writes pr.json atomically only after success. Authentication, timeout, invalid vendor responses and lease mismatch fail without false records.
4. Registered project selection wires pr.open after build. Ad hoc repositories remain local. The body contains the approved spec, door and rollback information; absent rollback is labelled explicitly.
5. Local bare/REST tests prove ref updates and refusal paths, no review endpoint is callable, default local behavior remains, and fail-first is retained against the base. No real GitHub operations occur.

Scope: src/adapters/github.ts, src/github.ts (shared headers), src/doors.ts (optional typed metadata), src/domain/code.ts, packs/firstmate/workflows/code-firstmate.wf.yaml, tests/github-foundation.ts, tests/github-foundation-ui.mjs, tests/smoke-code.ts (expected node order), tests/github-foundation-process.ts, tests/graph-tidy.ts, public/graph-layout.js (builtin stage membership only), tests/lib/github-simulator.ts, tests/fixtures/github-foundation/*, package.json, this document. Generated bundled assets only when required by the changed workflow.

Protocol: https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request and #update-a-pull-request; job-log redirect from https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run. The simulator returns the documented 302 then a local download asset with exact Range/Content-Range. Explicit merge/update-branch fixtures actually update bare refs and enforce their named head. PR responses use number, state, title, body, html_url, head.ref/head.sha/head.repo.full_name and base.ref/base.repo.full_name. Existing supported 2022-11-28 API version is retained. Fixture provenance is official documented examples, pared to the fields consumed; no live credentials or traffic recordings.

No captain sandbox is named. Real mode remains a capability that requires an explicit trusted grant; this unit neither configures nor exercises it. Remote CI, reconcile, naming approval UI and remote merge remain subsequent units. Local adapter continues local merging; GitHub-opted runs must be held before the local merge action until the remote merge unit exists.

Validation (worker, not approval):
- tests/github-foundation.ts: 71/0, real temporary bare refs + loopback REST; /tmp/github-foundation-green.log, .exit=0.
- tests/github-foundation-ui.mjs: 32/0; 16 overview/selection images under tests/out/github-foundation, 1440/390, light/dark, EN/zh-TW. /tmp/github-foundation-ui.log, .exit=0.
- Local coding smoke 27/0, existing OOTB 47/0, contract 76/0, runtime 56/0. Durable logs /tmp/github-foundation-{smoke-code,ootb,contract,runtime}.log and .exit=0.
- Fail-first against 922546475087d737b464ac326a01d57709340529: explicit project selection absent and actual lease-backed publication absent; 0/2, /tmp/github-foundation-failfirst.log, .exit=1.
- No full run started here; firstmate owns exact frozen integration full/review. No real GitHub request or remote push occurred.

Operational limits: trusted projects.json metadata is the explicit grant mechanism; project-add and run parameters cannot create a grant. A later naming/remote setup unit supplies the captain UI. No automatic REST write retry: after resolving authentication/rate limits, retrying publication recovers the durable PR/ref. Built-in definition hash creates a new version; already-running and user-edited workflows stay pinned. Old custom workflows cannot locally merge a GitHub-opted project. Remote gates/reconcile/merge remain held for subsequent units.

## R2 remediation

Standing must-fix 1: done. The two asynchronous Git operations (ls-remote and push) now use Node-compatible POSIX detached spawn with an owned process-group registry, TERM/KILL escalation, capped stdout and explicit bounded pipe closure. Cleanup confirms the owned group and leader have exited before deleting the temporary client or returning; an unconfirmed cleanup retains the client and reports a redacted failure. The adapter fails closed on Windows until equivalent owned-tree termination is supported. Studio basic/local workflows are unaffected. No service/model configuration changes.

SWEPT: Git helper lifetime / EOF dependency
- searched: all spawn/read/drain sites in src/adapters/github.ts, existing owned-group patterns in src/runtime/checks.ts and src/providers/proc.ts
- found 2 asynchronous Git command consumers, fixed 2 through the shared ownedGit runner
- tests cover ls-remote, push, TERM-ignoring parent/child, early successful leader exit, retained pipes, actual leader PGID and descendant/grandchild PIDs, redacted failure, absent PR record and post-cleanup client removal

Additional integration finding: pr-open is part of the Build loop's topology. The builtin stage-membership table now names it; the geometric inside-stage assertion is retained and supplemented with exact membership. Simple view expects the intentional 16-node main path. No layout algorithm was changed. Mobile UI tests expand the stage using existing Fit/keyboard controls and capture its readable selection details.

Primary process contract: https://nodejs.org/api/child_process.html#optionsdetached (POSIX new group/session) and #event-exit (exit does not imply pipe EOF). Installed Bun 1.3.11 verified actual PID=PGID in /tmp/github-foundation-r2-pgid.log.

R2 evidence: focused 71/0; process lifetime 24/0; graph 142/0; UI 32/0 with 16 renewed images; local coding smoke 27/0. Logs and durable .exit=0: /tmp/github-foundation-r2-{green,process,graph,ui,smoke}.log. Fail-first base is f88b6e95bc4682408fb44f5c4b64726351652657: process fixture red (boundedness and unowned group), graph fixture red (missing stage membership/geometry). /tmp/github-foundation-r2-failfirst.log and -graph-failfirst.log, .exit=1. No worker full suite started.

## R3 Runtime UI integration remediation

The updated workflow adds build → pr-open → ci. The Runtime UI fixture now edits that actual forward edge. Every port gesture resolves current DOM geometry after focus/fit and pointerdown, performs real mouse moves/up, and asserts the real underlying drop target; it does not synthesize a drop or relax graph validity.

The reconnect failure also exposed a real browser race: asynchronous validation/live redraw replaced an SVG owning pointer capture. Canvas redraw is now deferred during its gesture and flushed on pointerup or cancellation. Pointercancel/lost capture remove transient wires without adding edges. Navigation, editor-version switches and workflow-list disposal cancel the gesture, pending validation timer/request and editor live listener. Validation responses and save-error validity facts are bound to their current generation/editor owner; immediate validity facts still update while only the captured SVG is held.

Scope extension authorized by firstmate: public/runtime.js; tests/runtime-ui.mjs; tests/runtime-gesture-ui.mjs; package.json; this record. No renderer routing/layout algorithm, model/policy/config/service or remote-operation change.

SWEPT: asynchronous redraw / pointer ownership and validity response lifecycle
- searched: graph pointerdown/move/up, pointercancel/lost capture; buildEditor draw/validateSoon/save; workflow/list/version/hash navigation and editor live callbacks
- found: one captured-SVG replacement class; two asynchronous validity result sites (validation and failed save); navigation/version/list ownership release sites
- fixed: deferred redraw with cleanup at every gesture terminal path, generation/owner guards at both validity sites, editor disposal on all navigation sites

Evidence: exact-source Runtime UI 51/0, /tmp/github-foundation-r3-runtime-ui.log/.exit=0. Dedicated real-gesture suite 36/0, /tmp/github-foundation-r3-gesture.log/.exit=0; delayed responses come from the real validator via route.fetch; native mouse and Chrome touchCancel exercise the lifecycle. Eight new pending/completed gesture images under tests/out/runtime-gesture plus renewed Runtime UI captures under tests/out. Same gesture suite on frozen 1f39 is red in /tmp/github-foundation-r3-failfirst.log/.exit=1. Original integration failure remains /tmp/v2-github-foundation-r2-full.log. No worker full suite started.

## R4 asynchronous editor ownership

Standing review items 2 and 3: every content and layout edit advances a separate draft revision. Successful saves acknowledge their captured snapshot and advance the saved base while retaining later edits. A replaced editor disposes its validator, timer, live subscription and captured SVG before reload. Save alone is visibly disabled while its request is pending; editing stays available.

Only the active pointer can move, commit or cancel its gesture. Secondary pointerdown cannot replace the owner; foreign move/up/cancel/lost capture are ignored. Programmatic editor disposal remains unconditional. Real mouse plus CDP touch gestures test secondary end/cancel and owner capture loss without synthetic drops.

The graph UI fixtures assert the actual builtin publication topology: 16 Simple nodes and 27 Detail nodes/ports including pr-open. No renderer layout change. A dedicated ownership suite covers successful POST responses held after real persistence, late content and layout edits, repeated successful replacement aborting genuine in-flight validators, and desktop/phone EN/zh light/dark captures.

R4 evidence: ownership 73/0; Runtime UI 51/0; prior gesture lifecycle 36/0; graph UI 85/0. Durable logs /tmp/github-foundation-r4-{ownership,runtime,gesture,graph}.log and .exit=0. The same ownership suite against frozen bd743 is 36/37 red, /tmp/github-foundation-r4-failfirst.log/.exit=1, including both replaced validator owners and genuine two-touch ownership. Eighteen new images in tests/out/runtime-editor-ownership: pending visible Save state and retained draft across eight viewport/theme/language combinations, plus phone pointer ownership in both themes. Existing runtime/gesture/graph captures were renewed. No worker full suite or real remote operation.
