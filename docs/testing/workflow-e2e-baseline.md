# Workflow E2E baseline ledger

2026-10-19. Source baseline: `19dc426f111a33752202febaf922397a989083d5` (reviewed W29 candidate, not a claim of merge or deployment). This batch adds only crew-change acceptance coverage; no Watchbill/runtime production refactor.

## Evidence vocabulary and denominator

`PASSED API / STUB VENDOR` means a real temporary Studio, real OS sandbox configuration, scripted CLI providers, captain answers through HTTP, and checked terminal state/effects. It is not a personal visible-browser walkthrough, real vendor integration, or proof of every edge. `NOT RUN` below means not executed by this baseline batch, regardless of historical CI results.

19 shipped WDef sources: 9 public, 1 opt-in example, 6 internal, 1 held, 2 retired. The supported-execution set is 16; completing all 19 requires an explicit product decision for the held/retired definitions. Do not silently activate them. Five legacy Flow sources are compatibility inputs, not five more executable WDefs. User-created/drafted/template/installed-pack and historical pinned definitions form an additional, installation-specific denominator; not inventoried or run here.

| Workflow | Class | Existing YAML paths/scenarios (coverage declarations) | This batch |
|---|---|---|---|
| code-firstmate | public | dispatch wait; local merge; blocked/park; question/answer; two simulated GitHub merge paths | NOT RUN |
| documents | public | approve; changes then approve; Claude adapter | NOT RUN |
| web-prototype | public | approve A; real interaction smoke; reject | NOT RUN |
| images | public | approve; changes then approve | NOT RUN |
| video | public | approve | NOT RUN |
| file-organization | public | board/sample folder; Firstmate apply/discard | NOT RUN |
| coffee-kit | public | board; unavailable-film handling; sandboxed-e2e film approval | NOT RUN |
| pack-genesis | public | publish; close at interview | NOT RUN |
| hello-crew-studio | public | preview wait; approve to done | NOT RUN |
| startup-recursion | opt-in | accept; revise; close | NOT RUN |
| firstmate-proposal | internal | approve; close | NOT RUN |
| firstmate-register-project | internal | approve | NOT RUN |
| firstmate-staffing | internal | approve | NOT RUN |
| firstmate-connect-github | internal | approve | NOT RUN |
| firstmate-grant-merge | internal | no-token/close only; successful grant is a separate test, not complete acceptance | GAP: happy path |
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
