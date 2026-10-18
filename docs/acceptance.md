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
  Playwright and ffmpeg. It copies a real 1920x1080, 1 s sample film (`CREW_RENDER_STUB_MP4`) that
  the suite makes once with ffmpeg, so the video readiness probe reads a real MP4. Without ffmpeg the
  runs marked `needs: [ffmpeg]` print `SKIPPED` with the reason and do not count as passed. The coffee film needs the pinned HyperFrames toolchain, which the offline
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
the temporary Studio data and prints its path. The captain's throwaway folders and repositories are
made under that same temporary root, so nothing is left in `$TMPDIR`.

## Sandboxed profile

`bun run acceptance:sandboxed` (`scripts/acceptance-sandboxed.ts`) runs the same suite as a new captain's Mac
would: the OS sandbox and egress proxy on (never `CREW_LOCAL_UNRESTRICTED`), an empty `HOME`, no tool
cache (no Playwright browsers, no `PLAYWRIGHT_MODULE` or `NODE_PATH`) and no stand-in renderer. Only the
vendor CLIs stay stubs. What each workflow needs installed is read from its definition
(`scripts/acceptance/installs.ts`: `repo.prepare` needs git, a check script needs its `#!` interpreter,
`deliver.render` needs the renderer and ffmpeg) plus a run's own `needs: [renderer]` (the designer's
captures of a UI change). The suite asks the sandboxed Studio's Doctor what is installed. A run that
needs a missing install prints `SKIPPED` with the install named and does not count as passed. A
local-unrestricted run is skipped too. The summary ends with a table of which workflow needs which install
and whether this Mac has it. `tests/acceptance-sandboxed.ts` checks the profile itself.

## Sandboxed end-to-end gate

`bun run test:sandboxed-e2e` (`scripts/acceptance-sandboxed.ts --e2e`) is the pre-deploy gate: every bundled workflow to
its terminal state with the OS sandbox and egress proxy on. It is the sandboxed profile (never `CREW_LOCAL_UNRESTRICTED`,
an empty `HOME`, the environment stripped), but with this Mac's installed tools as the live board has them: Playwright's
Chromium from the account's cache (read by Studio's own renderer only; no round reaches it), ffmpeg and node on PATH,
and no stand-in renderer. So every capture, PDF print, interaction smoke and film render is real. A run it cannot finish
is a `FAIL`, never `SKIPPED`; without a Chromium cache it refuses to start and names the install. A local-unrestricted
run is not part of it. `bun run test:sandboxed-e2e:fast` (in `test:core`) runs five of its runs: documents (Codex and
Claude), the web interaction smoke, the film, and code-firstmate's local merge.

A stub run can name what its real side effects must show (`proves:`, `tests/acceptance/proves.ts`). The proofs that need
the real renderer are checked in this profile only:

- `pdf-chromium`: the exported PDF was printed by headless Chromium (not the built-in writer);
- `captures`: the designer's before and after captures are real PNGs of a rendered page;
- `film`: the rendered MP4 is a real H.264 film (the video workflow's Playwright + ffmpeg render; the coffee kit's
  HyperFrames render);
- `web-smoke`: the captain's named button was clicked in headless Chromium under the preview-tab CSP and changed the page;
- `fail-first`: the worker's test failed on the base and passed on the head, and CI passed;
- `sandbox-probe`: see below.

`profiles: [default, sandboxed, sandboxed-e2e]` limits a run to some profiles: the coffee kit's film goes to the
capability card where no browser exists (`confirm-film-unavailable`) and is rendered and approved where one does
(`film-approve`).

The sandbox probe: a run whose intent carries `{probe}` (setup step `probe`, or `probe-claude` for a Claude round) has the
scripted agent try, from inside its sandboxed CLI process, everything a real `codex` or `claude` could: a direct
connection to a public address and to a loopback port the harness listens on (both refused by the OS), Studio's tool
listener (reachable), a CONNECT through the egress proxy to its provider's API host (allowed; closed as soon as the proxy
answers, before any TLS byte, so no request reaches the provider), to another host (403) and without the round's
credential (407), its own login (readable; Codex's copy has no refresh token), the source login, Studio's ledger key and
projects, the account's own dotfiles and the private folders beside each tool on PATH (none readable), and writes into
Studio's data and HOME (refused). The result is one `ACCEPT_PROBE_RESULT` line in the round record; the harness fails the
run on any way out.

The GitHub path runs against the GitHub simulator (`tests/lib/github-simulator.ts`, in the harness process, its
`autoCi` mode: one required check green on every head, merges of the exact head accepted). Setup step `github-sim`
makes a money-kit repository whose origin is a bare repository the simulator serves, registers it through Firstmate,
and writes the signed simulator grant the captain's Connect card writes (`github-sim-ops` adds the operations grant);
Studio pushes there, opens the pull request from the repository's own template text on the captain's card, waits for
GitHub's required check, and merges (`github-merge-from-studio`) or finds the pull request the captain merged on
GitHub (`github-merge-on-github`, step `github-merge`). The acceptance Studio never asks `gh` or the keychain for a
token (`CREW_GH_NO_CLI=1`; a fixture token in its data).

## Known failures

A run with `known_failure` is a product bug that breaks the workflow on the live board today. It
prints loudly (`KNOWN-FAIL` and a `!!` block at the end) and does not fail the suite. When it starts
passing, the suite fails with `UNEXPECTED PASS` until its `known_failure` and its row here are removed. Its
`match` is a regular expression for the run's failure text: a run that fails some other way (a broken
setup step, a new bug on the same path) is a `FAIL`, not a known failure (`tests/acceptance-known.ts`).

No bundled scenario is currently marked `known_failure`. The synthetic fixture in
`tests/acceptance-known.ts` still verifies that unrelated failures cannot hide under that label.

Fixed on main since the harness was written: the startup founder and judge rounds ran in
`data/runs/<run>`, which the agent path check refuses (round cwd under `data/work` now), and the
startup accept card.

Not reproduced offline: the startup founder-model binding (the board start now resolves the
configured model before the card), test-command resolution (the stub worker's change passes
`bun test` in the sandbox repository), and Claude login detection without `USER`/`LOGNAME` (the
harness passes the login user through; the fixture's `keychain-user` mode is the place to add it).
