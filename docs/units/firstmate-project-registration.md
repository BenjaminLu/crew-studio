# Native Firstmate project registration and work continuation — ACKed implementation contract

Baseline: ca7f6cd238dbf200c74409a3d38753dceaff87ff. Spec-only; no production, live account, project or remote changes. A private captain path is evidence only and must never enter committed examples.

## Diagnosis

The installed primary exposes studio_list_projects (src/firstmate.ts20/23), but only enabled IDs/name/base, so the model cannot match a captain's local repository reliably. studio_propose_work intentionally requires a registered coding project and rejects raw repo/base/branch/worktree parameters (25–26). There is no native registration proposal tool. The main bootstrap names the tools but not this recovery path (src/host/main.ts nativeFreshText). Most seriously, src/host/codex.ts163 discards every native exception and substitutes one generic permission refusal, hiding malformed input, missing registration and disabled/revoked authority. This is an incomplete native recovery flow; asking the captain to visit Gates manually is not acceptance.

## Bounded contract

Add a source-owned native tool to prepare local project registration plus a pinned work intent. It accepts a local path, display name, registered workflow/version, captain brief and safe declared params; it cannot accept grants, remote URLs, arbitrary base, tool commands, card answers or paid-job approval. Existing studio_propose_work continues denying raw repo/base/branch/worktree. Read-only project lookup returns bounded local identities and explicit readiness/disabled state; auto-select only a unique matching enabled local identity, never arbitrary first project.

Preparation does bounded local metadata/Git reads only, with cancellation and current primary/thread/turn capability checked before and after awaits. Canonical working-tree root, git common directory, current source-selected existing branch/base, registry state and workflow definition hash are pinned. Protected Studio roots/private state, ancestors of protected roots, invalid/non-repository paths, ambiguous aliases and unsupported external grants refuse before allocation or network. No clone, fetch, push, config mutation or model call occurs.

A distinct source-installed versioned registration workflow raises a genuine captainOnly registration card identifying the exact canonical local path, branch/base, local-only authority and unchanged work brief. Only an actual authenticated captain answer may add that exact local project through the existing registry mutator. Closing/cancelling or primary-authority loss during preparation does not register. Once durably presented, the captain card has its existing independent lifecycle and can survive primary Stop/restart; only its authenticated answer can continue. Registry or filesystem identity drift requires a fresh card, never repair/adoption. Existing disabled/revoked/unconfirmed external records cannot be bypassed via a new alias or registration.

After registration approval, source code prepares the ordinary pinned firstmate dispatch card for the SAME stored workflow/version/brief/safe params, inserting only the confirmed project ID and registered base internally. The second captain approval starts exactly one actual existing code workflow child through original Engine.start/project/provider/capacity gates. Registration approval does not start coding work or answer the dispatch card. Durable signed registration/continuation records bind schema, proposal source, canonical identity, workflow definition, approved card and result. Restart/repeated tool calls/card answers cannot duplicate project, proposal or child; removed/malformed prior finality holds without rewriting historical evidence. Existing v1 firstmate-proposal records remain readable and unchanged; the new workflow has its own source version/schema.

Native tool failures use source-created structured public errors: invalid_params, workflow_missing, project_required, project_unregistered, project_disabled, project_revoked, project_ambiguous, target_changed, owner_ended and unavailable. Include bilingual safe guidance and allowlisted next action (list_projects / prepare_project_work / choose_project / captain_review); no raw exception/credential/config payload. Codex preserves these safe codes instead of flattening them; unknown errors remain generic fail-closed. Bootstrap explicitly guides lookup then registration card, never manual Gates/legacy scripts.

## Exact ACKed production scope

- src/firstmate.ts — integrate project tools, safe proposal errors and pinned continuation seam.
- NEW src/firstmate-projects.ts — bounded local identity lookup, source registration actions, durable captain confirmation and continuation.
- src/host/types.ts — source-created structured native failure type.
- src/host/codex.ts — preserve only that typed safe failure envelope.
- src/host/main.ts — native bootstrap recovery instructions only.
- src/runtime/index.ts — pass source-owned protected-root authority into the native controller and install before recovery.
- NEW workflows/v2/firstmate-register-project.wf.yaml — actual normalized native workflow, separate registration and ordinary dispatch approvals.
- src/bundled.gen.ts — generated embedding only.
- package.json — one owning test alias/main-chain inclusion.
- docs/units/firstmate-project-registration.md and docs/architecture.md — exact capability/schema/upgrade contract.

No src/doors.ts or generic Engine changes proposed initially; existing Projects.add and real cards/ledger are reused. If authority or atomicity needs an additional mutator, enumerate/request that exact hunk before edits. UI uses existing actual captain cards; no new generic route/layout.

## Exact tests and evidence plan

NEW tests/firstmate-project-registration.ts and NEW tests/lib/firstmate-project-fixture.ts: actual isolated server/owned app-server/real temporary Git repository and real code workflow. Owning tests/fixture/codex-account.mjs adds strict explicit registration/error scenarios only; tests/firstmate-native.ts preserves all earlier bridge/Stop negatives. tests/backbone-ui.mjs adds actual registration and subsequent dispatch captain-card interactions and 390/1440 light/dark EN/zh-TW captures. tests/takeover-ui.mjs has independently ACKed optional-discovery interaction repair, preserving all legacy assertions.

Fail-first uses existing actual native tool calls on ca7: unknown local repository cannot produce a registration card; invalid raw repo/base error is flattened; a clean-clone captain cannot continue to a project-ID dispatch without manual registry mutation. Fixed proof: lookup → real registration card → no registry write before answer → captain answer creates exactly one local registry identity → ordinary work card for the same pinned brief → only second captain approval creates one actual code workflow child. Offline provider may HOLD native round readiness, never false-complete. Assert existing branches/working checkout unchanged and no network calls.

Negative classes: raw params still denied; protected/nested/symlink/ambiguous identities; missing/disabled/revoked existing aliases; changed head/base/common-dir/workflow/registry; cancellation during held metadata and late callbacks; close card; forged/untrusted approval; repeated requests; restart before/after each approval; missing/malformed prior finality; cross-thread/turn inputs; unknown exception redaction. Legacy existing local registration and takeover UI behavior remain covered. No actual user repo/global auth/config or remote operations.

Root ACKed the enumerated scope plus same-file owner AbortSignal propagation in host/types.ts and host/main.ts. Source-owned per-call controllers abort on interrupt/pause/detach and are removed in finally; all pre/post-await live checks remain. Engine hook metadata reads use its existing run abort signal. Unverified owned Git cleanup retains the process reference and puts future registration into unavailable HOLD until restart, never reporting quiescence. New schema1 registration-start/result records precede and follow the synchronous registry mutator; uncertain/malformed prior starts or removed prior identities cannot replay. The new registration workflow uses existing dispatch-card kind, with a separate registration workflow identity/title and then a separate ordinary work card.

Current tests explicitly account for the existing synthetic demo registry seed; the earlier all-empty assumption is retained as invalid control, not a product defect. Initial unknown card-kind draft and fixture startup cancellation errors are retained honestly. Real native model/provider/skill staffing remains separately unverified; this unit proves one actual code workflow Task, never claims the first worker job was qualified or completed.

Pre-freeze focused evidence: corrected actual ca7 fail-first2passed/5failed EXIT1 (/tmp/v2-firstmate-project-corrected-failfirst.log/.exit); final actual registration/authority/cancellation suite25/0 EXIT0 (/tmp/v2-firstmate-project-final-backend.log/.exit). Prior native bridge/Stop34/0, host64/0, independent account34/0 retained. The owning UI mode STARTUP_PROJECT_UI=1 preserves normal startup controls and adds actual registration identity/action captures and two real captain answers; screenshots and final build remain pending until frozen-source execution. All invalid fixture controls remain retained, not accepted as product failures or passing evidence. Staffing/provider/worker skill confirmation is a separate required unit, not inferred from primary Codex identity or this code-child allocation proof.

## R2 closed-list remediation

Scope additionally includes `src/doors.ts`: strict source-owned registry snapshot and add-CAS; legacy list behavior stays unchanged. Resolve Git common-directory aliases before registration, bind ordinary dispatch to current repository metadata through second approval, consume durable continuation once, and refuse malformed/removed/changed registry snapshots without overwrite. Existing schema-1 registration evidence and unbound coding proposals are not upgraded implicitly. Tests use isolated local Git and synthetic data only.


### R2 formats and recovery

New registration identity schema 2 contains the original real Git root, Git directory/common directory, named base and full HEAD, filesystem device/inode, requested name, and strict registry `{exists,digest}` snapshot. Digests use full canonical JSON SHA-256 (registry digest hashes exact original bytes, or the distinct absent marker). A corrupt registry is never treated as an empty list. Registration uses a synchronous source-owned compare/read/recheck/atomic-rename operation; it preserves all original records and refuses changed snapshots. This is a cooperating Studio operation, not a filesystem protection mechanism against an independent writer racing after the final check.

Coding dispatch keeps its existing `project` workflow parameter but stores schema-2 repository binding plus the original project authority hash. Both card preparation and the second captain approval re-inspect and compare project/root/common/base/HEAD metadata. Non-coding proposal hashes retain their existing format. Legacy unbound coding proposals and schema-1 registration identities hold; no evidence rewrite or implicit authority upgrade occurs.

A signed continuation-start record consumes the registration's right to prepare work. A subsequent signed continuation record names the exact proposal. Missing or malformed referenced proposals and uncertain starts hold on recovery; they never allocate replacement work. Existing historical records remain intact. Public card bodies, options, layouts, host tools and browser assets are unchanged from 218; its 112 retained screenshots remain source-equivalent for presentation, not evidence for the newly added backend guards.
