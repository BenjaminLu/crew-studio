# Contributing to Crew Studio

Rules for people and coding agents that change this repository. Rules for the agents Studio itself runs are in
`src/operating-rules.ts` (Studio's agent rules) and the operating manual (`manual/`).

## From change to the live board

Every change takes the same path, in this order:

1. **Independent review.** A reviewer who did not write the change reads the diff and the tests. Fix what they find
   and have them look again.
2. **Rebase** onto the current `origin/main`. Resolve conflicts yourself, keeping both sides' intent.
3. **Core suites.** `bun run test:core` must pass on the rebased head: env-isolation, git-config-guard,
   firstmate-staffing, smoke-code, acceptance (its known-fail entries are listed in `tests/acceptance-known.ts`),
   privacy, opencc-only, and the build. Also run the suites that cover the files you touched.
4. **Push** your own branch only (never force-push a shared branch) and open the pull request.
5. **Merge** on GitHub once review and CI agree.
6. **Deploy** with `bun scripts/live-release.ts deploy`, and only when no Task is in flight
   (`bun scripts/live-release.ts status` lists them; deploy refuses while a step runs).
7. **Live end-to-end check** on the deployed release: run the workflow the change touches and confirm the result.

## Tests

- Every test entry file imports `./lib/isolated-env.mjs` on its first line, so no test reads the operator's `.env`
  or an inherited `GIT_DIR` (`tests/env-isolation.ts` enforces it). Register a new test file in `package.json`.
- A test that runs `git init`, `git config` or `--bare` builds its repositories under `checkedTempDir()` or checks
  them with `assertTempRepo()` (`tests/lib/git-hygiene.mjs`; `tests/git-config-guard.ts` enforces it).
- Tests use stub providers and temporary data. No test signs in, calls a paid model, or touches the live server,
  its port or its data directory.
- Each fix comes with a test that fails without it.

## Git

- Never write a shared git configuration (`git config` on the checkout, `core.bare`, hooks, remotes).
- Never `git stash` (the stash is shared by every worktree), `git bisect` in the checkout, force-push a shared branch,
  or `git add -A` / `git add .`. Stage files by name; never commit `node_modules`, `.env` or generated deliverables.

## Text and privacy

- Traditional and Simplified Chinese convert through `opencc-js` only. Do not add a character mapping table
  (`tests/opencc-only.ts` enforces it).
- No session links: never put a Claude conversation or session URL in a commit message, a pull request, an issue,
  a comment or any tracked file (`tests/privacy.ts` refuses them).
- Never print or commit a token, key or credential, nor a private name, company or absolute home path
  (`tests/privacy.ts`).
