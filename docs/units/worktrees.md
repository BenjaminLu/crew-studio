# Unit worktrees: one worktree per task, under Studio's data

What: `src/worktrees.ts` owns the task worktrees the coding workflow's rounds run in, and the runtime gives agent modes a `begin` and an `end` around each round so a mode can take its worktree and give it back.

Why: the captain's order (2026-10-14) round-sandbox → worktrees → code-firstmate-smoke; firstmate's lessons (a round that started on a stale local branch, a fresh worktree whose suite skipped for lack of node_modules, refused rounds whose work was wiped).

Done when (each line is proved by `tests/worktrees.ts`, new and red on the base):

1. One worktree per task at `data/work/<project>/<task>` on `branch_prefix` + task; never inside a protected root or the target repository's folder (real paths). — "the worktree lives at data/work/<project>/<task> …", "a worktree is never made inside a protected root or inside the target repository".
2. One round at a time: a round takes the worktree's lock; a second round is refused; a lock whose holder process is gone is stale. — "a second round cannot take a worktree a round holds".
3. Each round starts at the branch's durable head, checked before the agent starts: the remote branch's head when there is one, else the head recorded at the last hand-back; a stale worktree is corrected, and what it held is kept on a kept ref with a record. — "a worktree on a stale head is put back …", "nothing is reset without a record …", "with a remote branch, the round starts at the remote's head …".
4. Dependencies are installed before the agent starts (the frozen install of the lockfile the repository has: `bun install --frozen-lockfile`, `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile` or `--immutable`; or the project's install policy), so the suite runs, not skips. A lockfile whose package manager is not installed is a typed gap (`env.tool-missing`), never "nothing to install". — "a fresh worktree gets its dependencies … and its tests run".
5. A round hands back by a commit as the agent with `Crew-Run`, `Crew-Node`, `Crew-Round`, `Crew-Agent` trailers; that commit is the durable head the checks run on. Between rounds the worktree is read-only. — "a round hands back by a commit as the agent …", "between rounds the worktree is read-only".
6. A timed-out round keeps its partial work (handed back as it is); a report-only round keeps the code, and what it touched is kept on a kept ref. — "a round stopped at its time limit keeps its partial work …", "a report-only round keeps the code …".
7. Cleanup after a merge (or a cancel) leaves no worktree, lock or git worktree entry; kept refs stay `worktree.keep_days` days (policy, default 7). — "cleanup after a merge leaves no worktree, no lock and no git worktree entry".
8. At start, Studio sweeps worktrees no live run owns (their work kept first), stale locks, and folders no record names, each with its reason in `data/work/sweep.log`; a live run's worktree is never touched. — "a live run's worktree survives the startup sweep", "a worktree no live run owns is swept …", "a stale lock … is swept …", "a folder no record names is swept", "Studio's start sweeps a worktree whose run is not live …".
9. The runtime calls an agent mode's `begin` before its agent starts and its `end` however the round ends. — "the runtime calls a mode's begin before the agent and its end however the round ends".

The coding workflow's modes (`src/domain/code.ts`) use these in unit code-firstmate-smoke: `begin` = `startRound` (with the brief bound to the round and the head it starts from, recorded in the ledger), `after`/`onTimeout` = `handBack`, `end` = `endRound` and release.

## Source-only and offline rounds

- Spec rounds retain worktree ownership, durable-head reconciliation and read-only freezing, but skip dependency installation.
- A project policy `install: false` explicitly disables dependency installation for build and review preparation as well. Tests/checks still execute and fail normally if dependencies are missing; disabling installation is not evidence that dependencies or tests passed.
- Absent install policy preserves the existing lockfile default; an explicit command remains supported. Network permissions are unchanged.
