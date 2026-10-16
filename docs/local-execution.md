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
- Remove `CREW_LOCAL_UNRESTRICTED` (or set it to `0`) and restart to restore default isolation for new jobs.
- Regression checks: `bun tests/local-execution.ts` and `bun tests/local-host-execution.ts`.
