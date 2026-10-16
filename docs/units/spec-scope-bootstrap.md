# Spec scope bootstrap (2026-10-16)

## Status

- Local source patch, not a completed R-043 acceptance, not deployed, not committed/pushed.
- Existing R/SC records and signed ledger were not edited by this patch.
- Captain order: R-043 first, then R-038, then R-040. R-044 may proceed only without actual write conflicts.
- This bootstrap removes false spec reservations; it does not implement durable UI ordering or proposal version revision. Those remain R-043 work.

## Root causes and patch boundary

- `src/domain/code.ts` previously included every running/waiting/paused `ctx.spec.scope` in `inflight`, creating symmetric conflicts before write admission.
- `src/domain/code-queue.ts` now exposes a shared read-only reservation projection. Spec checks and build admission use authenticated signed reservations; active and terminal-unmerged reservations remain held. Corrupt tails preserve authenticated prefix held scopes, unknown authority fails closed, and dirty unadmitted worktrees are not ignored. Clean, never-admitted spec-only tasks do not reserve paths. Trusted never-admitted terminal cleanup does not create a phantom reservation.
- `caller-coverage` formerly demanded that each direct importer enter the write scope. Repeating spec refinement made this expand through successive import layers.
- Optional `verificationScope` lists explicit existing repository-relative caller files without granting write authority. It does not seed additional changed roots. Missing callers still fail; globs, directories, traversal and external symlink targets are rejected. This is a declared verification obligation, not proof that verification was executed.
- `spec_write`, spec persistence and readable spec output retain this distinction. The spec prompt now describes planned acceptance tests and expected base failures without asserting execution.
- `done-lines-observable` remains a nonblocking judged check. Its prompt now explicitly reviews specification-stage scenarios and assertion oracles, permits new tests absent from disk, and forbids demanding executed PASS/base logs at spec time. A named test alone is insufficient; findings must quote the supplied line, identify the missing observation and propose an actionable replacement. The deterministic `done-lines-provable` hint likewise calls for planned fail-first. Neither spec verdict is execution proof; build `firstmate/fail-first` and `gate-failfirst` remain unchanged. Live judge behavior and full R-043 acceptance remain unverified.

## Executed validation

- `node tests/caller-coverage.mjs`: PASS (existing import forms, read-only coverage, nonrecursive impact, invalid paths).
- `bun tests/spec-scope-blockers.ts`: PASS (isolated Git + signed ledger fixtures; active/terminal holds, corruption, dirty worktrees, cleanup, merge and project isolation).
- `bun tests/spec-verification-scope.ts`: PASS (real spec tool persistence, write-scope separation, legacy input, overlap identity handling).
- `bun tests/code-rescope-recovery.ts`: 55 PASS, 0 failed.
- `bun tests/contract.ts`: 76 PASS, 0 failed (fixture provider contract; not live vendor acceptance).
- Independent fresh-context review found a cancelled-worktree phantom blocker; fixed and regression tested. Re-review reported no remaining blocking finding in the bootstrap code.
- `bun tests/native-queue.ts`: BLOCKED before assertions: historical parent commit package.json unavailable (`dd8276f86da48df60e341b118e3a92bdffffbf8e` / `1aef6ea8030011032e7f3a8019bb31a1ea7a8bc8`). Not PASS.
- Caller fail-first reproduced against HEAD d2f55a70 in a temporary fixture: the unchanged test fails on the semantic assertion `read-only callers need no write reservation` (actual fail, expected pass); current checker passes. No missing import or environment failure was counted. This is only caller-check fail-first, not full R-043 or production UI ordering/revision acceptance.

## Original cards and minimal next actions

- SC-077 / R-043: captain already submitted rescope prioritizing bootstrap and narrower write scope. After loading the patch, use its current successor scope card (if any) to refresh the pristine base and regenerate spec. Keep the full ordering/revision acceptance conditions.
- SC-075 / R-038: captain already submitted rescope for R-043 first, then R-038; retain two independent Codex research reports and real vendor acceptance. Narrow write tests to actual files and put compatible callers in verificationScope. Do not dispatch build ahead of R-043.
- SC-073 / R-040: captain already submitted rescope to follow R-038; preserve rendering/security/legacy-data acceptance, narrow actual writes, and keep caller verification obligations separate. Do not dispatch build ahead of R-038.
- SC-078 / R-044: captain already submitted scope supplement for trustworthy lineage grouping, phase color plus text/icon, original R/SC drill-down and compatibility evidence. This does not reuse SC-074 approval for the new scope. Require the revised spec and fresh dispatch; no duplicate task.
- These are recorded decisions, not a claim that the current engine has loaded this patch or implements durable ordering. Inspect current cards before another action; never answer a stale card or replay an old response.

## Loading boundary

- Observed Studio process: `bun src/main.ts` from the development repository; no `--hot`/`--watch`.
- The patch is uncommitted. Existing pristine task worktrees still use their pinned base, so a new approved base commit and a controlled Studio restart are needed before UI rescope can read the changed source.
- The current Firstmate conversation is hosted by that Studio process. Restart is a handoff boundary: do not silently kill the current conversation or schedule an unobserved deferred restart.
- After the operator's commit/restart, resume from original cards, verify signed history and base identity, then perform real UI acceptance. Never edit runtime JSON or manually rewrite workflow snapshots/ledger to simulate loading.
- No dependency installation, remote PR, push, lock stealing or runtime-data patch was performed by this bootstrap.

## Final bootstrap follow-up

- Captain owns formal card operations and final commit/push. This follow-up performed no UI operations, Git staging/commit/push, server restart, or runtime-data edits.
- `bun tests/done-lines-observable.ts`: PASS. Covers nonexistent planned tests, missing test/expected-failure rejection, plan PASS not completion, and missing/stale/failed execution evidence keeping the build gate closed. Signed execution records here are isolated fixtures, not live vendor/build evidence.
- Independent fresh-context review of the observability follow-up: no blocking findings. It confirmed no changes to build fail-first checks or workflow gate edges.
- Revalidated caller coverage, spec scope blockers and spec tool persistence after operator integration to HEAD `dbb4221e`: PASS. Full native-queue remains blocked at the missing historical parent contract, before assertions.
- No bootstrap commit SHA is claimed. The operator's current HEAD is not proof this uncommitted patch is loaded; include the unstaged observability additions and new test in the final reviewed commit, then perform a controlled restart and original-card UI acceptance.
