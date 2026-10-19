# Workflow E2E baseline ledger

2026-10-19. Source baseline: `19dc426f111a33752202febaf922397a989083d5` (reviewed W29 candidate, not a claim of merge or deployment). Each batch below adds one approval-workflow gap; no Watchbill/runtime production refactor.

## Evidence vocabulary and denominator

`PASSED API / STUB VENDOR` means a real temporary Studio, real OS sandbox configuration, scripted CLI providers, captain answers through HTTP, and checked terminal state/effects. It is not a personal visible-browser walkthrough, real vendor integration, or proof of every edge. `NOT RUN` below means not executed by the batches recorded here, regardless of historical CI results.

19 shipped WDef sources: 9 public, 1 opt-in example, 6 internal, 1 held, 2 retired. The supported-execution set is 16; completing all 19 requires an explicit product decision for the held/retired definitions. Do not silently activate them. Five legacy Flow sources are compatibility inputs, not five more executable WDefs. User-created/drafted/template/installed-pack and historical pinned definitions form an additional, installation-specific denominator; not inventoried or run here.

| Workflow | Class | Existing YAML paths/scenarios (coverage declarations) | This batch |
|---|---|---|---|
| code-firstmate | public | dispatch wait; local merge; blocked/park; question/answer; two simulated GitHub merge paths | NOT RUN |
| documents | public | approve; changes then approve; Claude adapter | NOT RUN |
| web-prototype | public | approve A; real interaction smoke; reject | NOT RUN |
| images | public | approve; changes then approve | NOT RUN |
| video | public | approve | NOT RUN |
| file-organization | public | board/sample folder; Firstmate apply/discard; batch 3 checks actual apply/discard effects | PASSED API / LOCAL EFFECTS twice (target paths) |
| coffee-kit | public | board; unavailable-film handling; sandboxed-e2e film approval | NOT RUN |
| pack-genesis | public | publish; close at interview | NOT RUN |
| hello-crew-studio | public | preview wait; approve to done | NOT RUN |
| startup-recursion | opt-in | accept; revise; close | NOT RUN |
| firstmate-proposal | internal | approve; close | NOT RUN |
| firstmate-register-project | internal | approve | NOT RUN |
| firstmate-staffing | internal | approve | NOT RUN |
| firstmate-connect-github | internal | approve | NOT RUN |
| firstmate-grant-merge | internal | no-token/close; this batch adds authorized approve-squash/write/done and authorized close with signed scope proof | PASSED API / STUB VENDOR twice |
| crew-change | internal | close; this batch adds approve/apply/done with signed effect proof | PASSED API / STUB VENDOR twice |
| github-review | held | catalog reason and start refusal only | UNSUPPORTED: no successful execution claim |
| refine-demo | retired | catalog absence only | HISTORICAL ONLY: resume not run |
| trivial-lane | retired | catalog absence only | HISTORICAL ONLY: resume not run |

`tests/workflow-complete-ui.mjs` exercises editing/template reuse and explicitly asserts no Task starts. It is not workflow completion evidence. Synthetic cancel/resume/restart checks in `tests/runtime.ts` do not establish those paths for every shipped workflow. Per-workflow duplicate approval, cancel, resume, restart, artifact interaction, and root's personal browser evidence remain to be audited/filled incrementally.

## Batch 1: crew-change approval

The existing close-only scenario could not establish that a real approval persisted the team. New `approve` runs Firstmate's existing native tool, answers the actual captain card, and requires `confirm → apply → done`, never `closed`. `crew-applied` verifies the signed CrewStore configuration, expected maker provider/model/effort, authenticated ledger, exactly one matching captain answer and crew-approved receipt, answer-before-receipt order, and the persisted run/card/answer-sequence binding. The runner also compares the actual Task definition against the scenario's reviewed SHA-256 pin (`b394823a848f3b996031ae4558b9c79bf6874d607d6780d7ae29e22b47854606`).

Only `how: crew` changes server sharing: each such scenario gets its own temporary Studio, HOME and data. All other scenarios retain their existing sharing. This prevents a real team approval from changing unrelated parallel scenarios' staffing. The Doctor continues using its existing shared sandbox server. Cleanup still closes every registered Studio.

Negative control: temporarily requiring `crew-applied` on the original close case failed with `no approved team was persisted` (`/private/tmp/watchbill-crew-applied-negative.log`). This demonstrates the new proof rejects the old non-apply path; it is not a production bug claim. The temporary mismatch is not committed.

Final repeated command (two separate processes, fresh stores, sandboxed-e2e profile, no skipped cases):

```sh
ACCEPTANCE_ONLY=crew-change ACCEPTANCE_KEEP=1 bun scripts/acceptance-sandboxed.ts --e2e
```

Both runs: **2 pass, 0 known-fail, 0 fail, 0 skipped, 0 coverage problems**. The summary's “19 bundled workflows” is inventory, not 19 executed workflows.

- Logs: `/private/tmp/watchbill-crew-approve-final1.log`, `/private/tmp/watchbill-crew-approve-final2.log`.
- First approved Task: `R-001`, retained root `crew-acceptance-crew-change-approve-kOCPQp` under the macOS temporary directory.
- Second approved Task: `R-001`, retained root `crew-acceptance-crew-change-approve-Sw0roP` under the macOS temporary directory.
- Related regression: `bun tests/crew-cards.ts`: **24 passed, 0 failed** (`/private/tmp/watchbill-crew-cards-related.log`).

Temporary paths are local evidence, not portable checked-in artifacts. No live 4210 data, real vendor credentials, external GitHub writes, publication, deployment or root browser walkthrough were used. This small batch remains subject to independent review before integration; it does not establish the complete pre-refactor baseline.


## Batch 2: firstmate-grant-merge approval

Parent: `8e39402b` (crew-change batch, independently approved by root's reviewer). This separate change adds `approve-squash` and `close-authorized`, retaining the original no-token case. The existing `github-sim` fixture seeds only a signed simulator connection, temporary local bare remote and dummy token; `merge-access` supplies the read-only repository permission response. The production Firstmate tool, captain card, write handler and signing path remain real and unchanged.

Before answering, `merge-ungranted` checks that operations permission is absent. Final proofs validate the signed project grant against its registered path/origin, exact simulator API origin, repository `fixture/project`, base `main`, branch prefix `crew/`, chosen squash method, approval ID/time, authenticated captain answer and matching `grant-merge` receipt/answer sequence. The close case must have no operations grant or grant receipt. The simulator trace must contain the repository GET probe and no non-GET request. These cases do not create or merge a real pull request.

Merge-grant scenarios now use separate temporary Studio instances, just like crew-change, so a dummy token or registry write cannot affect another scenario. Other server-sharing behavior is unchanged. Both workflow families compare the actual Task definition to the reviewed scenario pin. Merge-grant pin: `74451da530547ec83f78c7682bffb9ab8ab2ae0ddf943eb34e0b4f9c0a60bb65`.

Observed RED: with the original simulator repository response (no push permission), the real access probe offered only `check/close`; `grant-squash` was refused with HTTP 400, and `write/done` were not visited. `/private/tmp/watchbill-merge-grant-red.log` records this fixture gap. Only a test-owned GET response was added; no production access check was relaxed.

Two fresh sandboxed-e2e runs:

```sh
ACCEPTANCE_ONLY=firstmate-grant-merge ACCEPTANCE_KEEP=1 bun scripts/acceptance-sandboxed.ts --e2e
ACCEPTANCE_ONLY=firstmate-grant-merge,crew-change ACCEPTANCE_KEEP=1 bun scripts/acceptance-sandboxed.ts --e2e
```

- Run 1: **3 pass, 0 fail, 0 known-fail, 0 skipped**, `/private/tmp/watchbill-merge-grant-run1.log`.
- Run 2: **5 pass, 0 fail, 0 known-fail, 0 skipped** (three merge-grant cases and two crew-change regressions), `/private/tmp/watchbill-merge-grant-run2.log`.
- Approval Task in each run: `R-002`; retained roots `crew-acceptance-firstmate-grant-merge-approve-squash-mLkBAG` and `crew-acceptance-firstmate-grant-merge-approve-squash-mp0l4q` under the macOS temporary directory.
- Existing `bun tests/merge-grant.ts`: **32 passed, 0 failed**, `/private/tmp/watchbill-merge-grant-related.log`.

Still API-driven with stub vendor identity, not root's visible-browser acceptance. Revoke, stale registry, forged grants and merge execution are covered separately in `merge-grant.ts`; they are not newly claimed as complete acceptance paths here. Independent review of this second batch is required before integration or another gap.


## Batch 3: file-organization effects

Parent: `8ff764a6` (merge-grant batch, independently approved by root's reviewer). Strengthens the existing board apply and Firstmate discard scenarios without changing runtime behavior. The folder fixture snapshots all four original file contents; immediately before answering the real card, it checks that the whole original directory is unchanged and captures the exact reviewed dry-run plan. Final checks compare the persisted plan to that snapshot, require the signed captain answer and preceding passing gate receipt at the same plan hash, and enforce the scenario definition pin.

Apply must move every reviewed file, preserve every byte at its planned destination, remove all original sources, match the moved count, leave exactly the planned output files, and produce one matching undo row per move. Discard must preserve the complete original directory/bytes and produce neither apply state nor an undo log. This batch does not claim equivalent filesystem proofs for the sample-folder or Firstmate apply scenario; those are neighboring terminal-path regressions only. It does not test undo execution or restart recovery through this HTTP harness.

Final repeated commands:

```sh
ACCEPTANCE_ONLY=file-organization:board,file-organization:firstmate-discard ACCEPTANCE_KEEP=1 bun scripts/acceptance-sandboxed.ts --e2e
ACCEPTANCE_ONLY=file-organization ACCEPTANCE_KEEP=1 bun scripts/acceptance-sandboxed.ts --e2e
```

- First fresh run: **2 pass, 0 fail, 0 known-fail, 0 skipped**, `/private/tmp/watchbill-fileorg-approved1.log`; board `R-001`, discard child `R-003`, retained Studio root `crew-acceptance-sandbox-BiTRuU` under the macOS temporary directory.
- Second fresh run: **4 pass, 0 fail, 0 known-fail, 0 skipped**, `/private/tmp/watchbill-fileorg-approved2.log`; board `R-002`, discard child `R-006`, retained root `crew-acceptance-sandbox-3y32d1`.
- Negative controls against retained actual applied fixture data: corrupt destination bytes, remove destination, remove undo log, and corrupt an undo source. All four are rejected; restoration passes again. `/private/tmp/watchbill-fileorg-negative.log` and its adjacent `.ts` reproduction script record these ad hoc checks; the script is not a new CI test or a standalone portable test fixture.
- Related existing regression `bun tests/non-code-workflows.ts`: **121 passed, 0 failed**, exit 0, `/private/tmp/watchbill-fileorg-related.log`. It includes the existing fileorg move/undo/replay/stale-plan assertions along with other non-code workflows.

All filesystem mutations were confined to generated test folders. No user files, real providers, live Task/store, remote effects or deployment were used. Library missing-version validation remains a separate known audit gap. Root's visible-browser acceptance and baseline repetition against newly merged main remain outstanding; these results use the recorded production baseline `19dc426f` plus test-only patches. Independent review is required before another batch.


### Batch 3 review correction: persistent negative controls

Independent review rejected the initial batch because the negative controls were only ad hoc files in /tmp. They now run automatically from the existing registered acceptance command after every successful `files-applied` proof. The helper uses that run's fresh generated folder, canonicalizes the temporary Studio root, corrupts/restores bytes, destination presence, undo presence and undo source, requires the appropriate rejection for each, then verifies restoration. No retained path or new test framework is required.

Mutation verification: temporarily disabling the test-only byte comparison made the registered board scenario fail with `negative control mutated bytes`; disabling the undo-source match made it fail with `negative control mismatched undo`. Logs: `/private/tmp/watchbill-fileorg-weakened-bytes.log`, `/private/tmp/watchbill-fileorg-weakened-undo.log`. Both verifier edits were restored before final runs; production was never changed.

Corrected final two fresh runs: **2/0/0 skipped** for board/discard and **4/0/0 skipped** for all existing fileorg scenarios, in `/private/tmp/watchbill-fileorg-persistent-final1.log` and `...final2.log`. Retained roots `crew-acceptance-sandbox-KrCytW` and `crew-acceptance-sandbox-5rK8zB`. These runs include the committed negative controls. The previous 121/0 related-suite result remains valid; that broader suite was not rerun for this test-helper-only correction. Same-reviewer recheck is required.
