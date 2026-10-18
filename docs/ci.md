# Continuous integration

`CI` runs on pull requests and pushes to `main`. During initial rollout it also
runs core and full suites on `chore/github-ci-*` pushes so the initial branch can
be verified before the workflow reaches the default branch. Nothing in this workflow deploys Studio.

- **Linux portable checks** runs environment isolation, temporary Git protection,
  CI runner regression checks, and the build on Ubuntu 24.04. It does not assert
  Linux round-sandbox support.
- **macOS core** runs every command in the existing `test:core` script on macOS 15,
  including real sandboxed acceptance and rendering. A missing prerequisite is a
  failure; the workflow installs Chromium and ffmpeg rather than a fake renderer.
- **macOS full (1/4 through 4/4)** runs every command in `test`, expanding script
  aliases, every day at 19:23 UTC and on manual dispatch with `full` enabled.
  There are no exclusions for known failures. A failing command does not prevent
  later commands from running, and a failing shard does not cancel its siblings.

Each job uploads `ci-results/` for seven days, even after test failure. It contains
one log per command, incremental `results.json` with exit/timeout/duration, and a
final `summary.md`. A command has a ten-minute timeout; a whole core job has 45
minutes, and each full shard has 120 minutes. Cancellation or a job-level timeout
can leave an incomplete results file; do not call that a full-suite pass. Individual
suites may report their existing explicit `SKIPPED` cases; inspect their logs.

The runner derives its inventory directly from `package.json`. New test entries
in `test` automatically join the full run. Current scripts use `&&` between
commands; if shell constructs containing `&&` are introduced, update the inventory
parser and its tests before relying on CI coverage.

## Local reproduction

Install the locked dependencies with `bun install --frozen-lockfile`, use Bun
1.3.11 and Node 22.22.0. Playwright 1.64.1 is a locked dev dependency; install
Chromium with `node node_modules/playwright/cli.js install chromium`. Keep the
module inside the repository: sandboxed acceptance deliberately clears module
path overrides and uses the repository renderer dependency. macOS core/full also needs ffmpeg and a host that permits
`sandbox-exec` and ephemeral loopback sockets.

```sh
node scripts/ci-tests.mjs --mode core
node scripts/ci-tests.mjs --mode full --shard 1/4
node scripts/ci-tests.mjs --mode full --list
node scripts/ci-tests.mjs --mode test:ci:portable
```

All commands run in a filtered environment: basic operating-system paths/locale,
Playwright configuration, `CI=true`, and `BUN_OPTIONS=--no-env-file`. GitHub tokens,
Actions runtime credentials, and operator Studio settings are not inherited by
tests. Tests retain their own `isolated-env.mjs` guard and real-provider CLI
sentinels. Git checkout keeps the history required by historical contract tests, and does
not persist credentials. The workflow has only
`contents: read`, uses immutable action SHAs, and never uses `pull_request_target`,
repository secrets, self-hosted runners, or production data.

A green CI result is test evidence, not proof that W29's same-uid process isolation
or detached-process cleanup risks have been resolved. macOS process-group cleanup
in this runner bounds ordinary fixtures; it is not a security boundary against
hostile `setsid`/re-exec code.

The schedule takes effect only after this workflow reaches the default branch.
Use the stable `Linux portable checks` and `macOS core` checks for future branch
protection once the first remote runs are verified; branch protection is not
changed by this patch. Full-suite checks are intentionally separate because they
are scheduled/manual and may report existing failures.
