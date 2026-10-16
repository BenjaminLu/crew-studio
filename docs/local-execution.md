# Local unrestricted execution

- Default execution remains sandboxed. An operator can opt a local Studio process into unrestricted execution in its ignored `.env`:

```dotenv
CREW_LOCAL_UNRESTRICTED=1
CREW_LOCAL_DEPENDENCY_ROOT=/absolute/path/to/crew-studio
```

- Restart Studio after changing these values. Existing running jobs retain their previous execution mode.
- This disables Studio's OS sandbox wrappers and model-only egress proxy restrictions for worker, image, and check processes. Codex Firstmate uses `danger-full-access` for fresh, resumed, and forked threads and each turn. Claude Firstmate was never wrapped in Studio's OS sandbox or egress proxy; in this mode its first message carries the same local execution notice, and its permission bridge, deny rules, `--strict-mcp-config` and user-only settings stay.
- Dependency installation is instructed to remain within the configured repository, never globally. With OS isolation disabled, this is an agent instruction, not a filesystem enforcement boundary.
- Task scope, registered project identity, captain approvals, signed staffing/ledger checks, private worker login handling, tool authority, and artifact validation remain in effect.
- Job records report `executionMode`; Doctor and startup output explicitly report disabled isolation. This mode does not imply that a workflow passed acceptance.
- Same-user isolation of Studio's tool tokens is void in this mode: unsandboxed processes run as the captain and can read the 0600 token and MCP config files of a Studio-owned Firstmate (Claude) and call its pre-allowed Studio tools.
- Shared git config is writable in this mode. A task worktree's commits, refs and the shared `<repo>/.git/config` live in the project's own git folder, outside the worktree. In default mode the round sandbox writes only the worktree, its tmp and its throwaway home, and denies the worktree's `.git` link, so a round cannot change that config. In this mode, worker, reviewer and check processes run unconfined as the captain, from inside the worktree. A `git config core.bare true` (or `core.worktree`, `core.hooksPath`) there writes the shared config of the project and of every linked worktree. Studio does not block this. The Doctor's "Shared git config" item and startup output report a broken shared config (core.bare=true, an unexpected core.worktree, a hooksPath outside the repository) for Studio's checkout, every registered project and `data/demo-repo`, and Studio refuses to make or use a task worktree on it (`shared_git_config_broken`). Nothing is fixed automatically.
- Remove `CREW_LOCAL_UNRESTRICTED` (or set it to `0`) and restart to restore default isolation for new jobs.
- Test suites never read this `.env`: every test entry imports `tests/lib/isolated-env.mjs` first, which drops values that came from a `.env` and gives every bun child `--no-env-file`. A test that needs unrestricted mode sets the variables itself. `bun tests/env-isolation.ts` fails if a `.env` leaks into a test.
- Regression checks: `bun tests/local-execution.ts` and `bun tests/local-host-execution.ts`.
