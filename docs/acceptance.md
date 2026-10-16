# Workflow acceptance harness (offline)

`bun run test:acceptance` (`tests/acceptance.ts`, last step of `bun run test`) runs every bundled
workflow end to end through the production path, offline, in about a minute.

It exists because workflows passed their tests and then failed on the live board: the tests used
in-process fake providers, which skip the gates the board path runs. This harness skips none of them.

## What is real and what is a stub

Real: `bun src/server.ts` on a free port with a temporary `CREW_DATA` and `HOME`; the board's start
route (`POST /api/wruns` with exactly the body the Start form sends); Firstmate's own native tools
(through the Firstmate chat on the codex primary); the card API with the captain's session;
`Agents.execute`, the round sandbox profile (`sandbox-exec`), the egress proxy, the agent path check,
the round env and login copy, the native provider selection and capability probes, staffing
admission, the signed ledger, round records, checks, artifacts and the Library. One run uses Studio in
local-unrestricted mode.

Stubs, bound through the existing overrides (`CREW_CODEX_BIN`, `CREW_CLAUDE_BIN`, `CREW_HOST_CODEX_BIN`):

- `tests/fixture/codex-account.mjs` is `codex`: `login status`, the `app-server` JSON-RPC capability
  probe, the Firstmate primary, the dedicated image app-server (it answers as
  `tests/codex-image-fixture.mjs`), and `codex exec --json` rounds.
- `tests/fixture/claude-native.mjs` is `claude`: `auth status`, the bounded verification request and
  `claude -p --output-format stream-json` rounds.
- Both switch to the scripted agent (`tests/acceptance/agent.mjs`) only for the harness's fixture
  logins (codex account id `fixture-acceptance`, a Claude OAuth token of the official shape starting
  `sk-ant-oat01-acceptance`). The agent starts the MCP server named on its command line, lists the
  round's tools and calls them over MCP, and prints the vendor's own event shapes. Its scripts are
  `src/providers/stub-agent.ts` plus the modes it lacks (deliver, startup, coffee page, a worker ASK).
- The film renderer is a local tool: its existing stub (`CREW_RENDER_STUB=1`) stands in for
  Playwright and ffmpeg. The coffee film needs the pinned HyperFrames toolchain, which the offline
  harness does not have, so the coffee run takes its capability path.

## Scenarios

The scenario list is shared with the live driver (`scripts/live-acceptance.ts`): one file per bundled
workflow in `tests/acceptance/<id>.yaml`, read by `scripts/acceptance/scenarios.ts`. The harness adds
a `stub:` list of offline runs to each file (fields in `tests/acceptance/stub.ts`). Internal and
retired workflows have a file too, with `live: false`, so the live driver skips them.

A bundled workflow (`workflows/v2/*.wf.yaml`, `packs/**/*.wf.yaml`, the packs' legacy
`*.flow.yaml`) without a scenario file, or with no `stub:` run, fails the suite:
`no acceptance scenario for workflow X`.

Each run checks: the terminal status and result, every node visited (and the other branch not
visited), no refusal from the agent path check, the pinned outputs and the approved Library entry
where the workflow makes one, and no generic error text (`[object Object]`, `undefined`, a bare
`TypeError`, "the agent run failed" …). A card the run does not script stops it as a failure.

`ACCEPTANCE_ONLY=documents,code-firstmate:firstmate-ask` runs a subset; `ACCEPTANCE_KEEP=1` keeps
the temporary Studio data and prints its path.

## Known failures

A run with `known_failure` is a product bug that breaks the workflow on the live board today. It
prints loudly (`KNOWN-FAIL` and a `!!` block at the end) and does not fail the suite. When it starts
passing, the suite fails with `UNEXPECTED PASS` until its `known_failure` and its row here are removed.

| Workflow · run | Node | Error | Root cause | Fix that should cover it |
|---|---|---|---|---|
| code-firstmate · firstmate-ask | build (2nd visit) | the worker's ASK reaches the scope card (rescope or park, no way to answer); after the captain rescopes with the answer, build raises "Round is not ready": `native scope pin changed or uses unknown hash algorithm; fresh preparation required` | `src/domain/code.ts:666` maps ASK to `blocked` (and `:78`); `packs/firstmate/workflows/code-firstmate.wf.yaml:198` routes `blocked` to `scope-card`; the rescoped spec changes its hash and `src/domain/code-queue.ts:115` refuses the existing scope pin | `code-ask-loop-r4-20261016` |
| code-firstmate · board | start | `400 Staffing approval requires confirmation: Staffing approval missing or changed` (staffing approved, project given) | `src/runtime/index.ts:264-268` binds `params._staffing` only for coffee-kit; the staffing guard (`src/domain/staffing.ts:114` → `:106`) needs it, so a board start of code-firstmate is always refused | `board-start-fixes-20261016` |
| file-organization · board | plan | `give the folder's absolute path` | the Start form sends only `{provider}` (`public/runtime.js:578`); `POST /api/wruns` (`src/runtime/index.ts:251-269`) starts a Task without its declared params (`params.folder`), and `src/fileorg.ts:30` refuses later | `single-source-contracts-20261016` |
| github-review · board | start | `400 GitHub review template is saved for editing only …` | `src/domain/github-review-workflow.ts:31` refuses every start, while `selectable()` (`src/runtime/defs.ts:214`) lists it, so the Start form offers it | `board-start-fixes-20261016` (held: not offered) |

Fixed on main since the harness was written: the startup founder and judge rounds ran in
`data/runs/<run>`, which the agent path check refuses (round cwd under `data/work` now), and the
startup accept card.

Not reproduced offline: the startup founder-model binding (the board start now resolves the
configured model before the card), test-command resolution (the stub worker's change passes
`bun test` in the sandbox repository), and Claude login detection without `USER`/`LOGNAME` (the
harness passes the login user through; the fixture's `keychain-user` mode is the place to add it).
