# Live acceptance

A workflow is done only after a live acceptance run on the live board, with real models, after the
change is merged and Studio is restarted (captain rule, 2026-10-16). `scripts/live-acceptance.ts`
makes that run repeatable and its report honest.

## When to run it

1. The change is merged to `main`.
2. The live Studio is restarted on the merged code (its board answers on `http://127.0.0.1:4210`).
3. The vendors the workflow uses are signed in. Check this in Studio's Doctor. The script only
   reads login state. It never starts a sign-in.
4. Run it from a checkout of the merged `main`:

```sh
bun scripts/live-acceptance.ts --workflow documents
bun scripts/live-acceptance.ts --all                  # every scenario in tests/acceptance/
bun scripts/live-acceptance.ts --workflow file-organization --params params.json   # captain input
```

Options: `--base http://127.0.0.1:<port>` (default 4210), `--topic "..."` (replaces the
scenario's brief), `--max-minutes N` and `--max-rounds N` (override the scenario's budget),
`--scenario <file>` (one scenario file), `--scenarios <dir>`.

Real models cost money. Run one workflow at a time unless you mean `--all`.

## What it does

- **Finds Studio** the way `bun src/main.ts open` does: the registered instance record and its
  session (`src/instance.ts`), matched to `--base` by port. The session goes only into the
  `x-crew-session` header. It is never printed or written.
- **Checks the definition pin**: the workflow Studio serves must have the sha256 the scenario was
  reviewed against (`bun scripts/acceptance/pin.ts <id>` prints it). A different definition stops the
  run before it starts; the run's own definition is checked again before every card.
- **Checks login state** (GET `/api/doctor`) for every vendor the run may call. The engine picks a
  vendor in this order: the node's own provider, then its role's provider, then the Start form's
  provider, then Studio's policy (the opposite of the host, then a fallback). The script follows the
  same order for agent nodes, loop coordinators and judged checks; where the policy decides, Claude
  and Codex must both be signed in. When Studio shows a staffing plan, its picks are checked before
  the confirmation is sent. A vendor that does not report signed in stops the run before any Task
  starts. When the login cannot be read (the CLI fails, or reports neither state), the run also
  stops, and the message and report say which provider, why it was needed, and what the Doctor
  reported. The Studio stub provider is refused: live acceptance needs real models.
- **Starts a Task** with exactly the body the board's Start form sends: `{text, workflow, params}`.
  The brief starts with `ACCEPT <date>`. If Studio asks for a staffing confirmation, the script
  confirms it only when the scenario allows staffing approvals.
- **Follows the run** over Studio's event stream (`/api/stream`) and reads the Task
  (`/api/tasks/<id>`) on every change.
- **Answers captain cards from an allowlist** (`scripts/acceptance/scenarios.ts`). A card is
  answered only when all of these hold; otherwise the run stops:
  - the run's definition has the scenario's pinned sha256;
  - a rule names the card's node, its kind and an option the card really offers. Only the kinds
    `acceptance`, `question` and `plan` can be answered. Dispatch, scope, step-back, round-budget,
    merge, promote, permission and any new kind are the captain's;
  - the card has options, and no one-way door on `door`, `detail.door.kind` or `confirmDoor`;
  - a captain-only card is an exact (workflow, node, kind, option) entry in `CAPTAIN_ONLY_ALLOW`,
    bound to the same definition hash. Today that is the deliver acceptance cards'
    `approve-<producer>` options (their artifact goes to the local Library) and the startup
    competition's two cards;
  - no authorization window is open for the run's project: an open window can answer a later
    card without the captain, so that card would be no gate;
  - the card's own node has no unreviewed card mode (`REVIEWED_CARD_MODES`), and the chosen option
    sets off no card `effects` (such as `{policy: round_cap, add: 2}`) that are not allowlisted;
  - the workflow has no lifecycle `hooks`;
  - every node the answer can reach before the next card runs only actions in `LOCAL_ACTIONS`.
    The walk follows every out-edge, of the card node and of every node after it. An edge's
    blocking checks re-route its source as `fail`, and which outcome a model, a check or a card mode
    produces is not known in advance. The card's own node counts when a hook raised the card. Any
    other action stops the run: `pr.open`, `remote.ready`, `github.*`, `git.merge`, `firstmate.*`,
    `fileorg.apply`, `pack-genesis-publish`, the coffee kit's paid generation (`coffee.image`,
    `coffee.video`, which the captain directs), and any action not yet reviewed. No names are matched.
  - the next card the walk reaches runs its own start code when it opens, so its card mode must be in
    `REVIEWED_CARD_MODES` and its body builder (`body_from`) in `REVIEWED_CARD_BODIES`; `merge`, for
    one, reads GitHub and stops the run.
- **Enforces a budget**: a maximum wall time and a maximum number of Rounds. A run over budget is
  cancelled, so it spends nothing more, unless a card waits for the captain (see below).
- **Never leaves a started Task unreported**: on a transport or script error, or a failed read of the
  Task, the report is still written (verdict ERROR) and the Task is cancelled, retrying while Studio
  restarts. A Task waiting on a card for the captain is not cancelled: it is left for the captain,
  and the report says so. The report gives the real number of cancel attempts. When a start or answer request got
  no reply, the report warns that it may have been applied on the server.
- **Never cancels under a person**: when a card waits for a person (`action: wait`), neither budget
  nor an error cancels the Task. The run stops, and the Task is left for the captain.
- **Removes credentials** from everything it prints or writes. That covers the run error, node
  errors, the brief, start params, error messages and stack traces. The session is removed, and so
  is anything Studio's own redactor (`src/secure.ts`) treats as a credential.
- **Records what really ran**: every model call the run made, from its own records. That means
  agent Rounds, every job a node ran (loop coordinators included) and judged-check votes. Each
  node's provider and model come from its Rounds. An agent node that ran Rounds with no provider
  recorded fails the real-model check. A hook node that
  calls a model itself (`image.generate`, `coffee.image`) gets them from the provenance of the
  artifact it made. A model hook with no such record fails the real-model check.
- **Writes a report** to `data/acceptance/<date>/<workflow>.md` and `.json` in the target Studio's
  data folder, and prints both paths. A second run on the same day gets `<workflow>-2`.

A STOP leaves the Task as it is (waiting on its card), so the captain can look at it and answer it on
the board.

## Library items from acceptance runs

The scenarios for Documents, Images, Video and Web prototype approve their acceptance card. The
approved artifact goes into Studio's own local Library, never out of the machine. The Task's brief
starts with `ACCEPT <date>`, and the report lists each such Library item under "Library items
(acceptance run)", so it is never mistaken for real work.

## Reading the report

The top lines give the verdict, the Task link, the exact start body, the provider login states, the
budget used and the event-stream counts. Then:

- **STOP**: why the run stopped and which card.
- **Run error**: the run's own error, verbatim.
- **Unmet expectations**: each way the run differs from the scenario.
- **Nodes**: one row per node the run reached. Each row has its status, outcome class (`pass`,
  `fail`, `error`, `interrupted`, `skipped`, `incomplete`), provider and model, Rounds, duration, a
  log link and the first error. An agent node's log link opens its transcript on the board
  (`#/runs/node/<task>/<node>/<round>`). Other nodes link to the Task.
- **Captain cards**: every card the script answered, left for a person, or stopped on.
- **First errors (exact text)**: the first error of each failing node, verbatim, with its log link.

The JSON file holds the same data for tools.

## What counts as pass

| Verdict | Exit | Meaning |
|---|---|---|
| PASS | 0 | No card stopped the run, the budget held, every agent Round ran on a real model (Claude or Codex), and the run ended as the scenario expects (`expect.status` and `expect.result`, or reached `expect.stop_at`) with its expected artifacts. |
| FAIL | 1 | The run ended, but not as expected: wrong status or result, a missing artifact, a Round on a non-real model, or the Task could not start. |
| STOP | 2 | A card that is not safe to answer, a vendor that is not signed in, missing captain input (`required_params`), or a staffing or dispatch approval the scenario does not allow. |
| BUDGET | 3 | The wall time or Round budget ran out. The Task was cancelled. |
| ERROR | 4 | A transport or script error after the scenario loaded. The report is written and a started Task cancelled, unless it waits on a card for the captain: then it is left for the captain. A bad scenario file, bad arguments or no verified Studio at `--base` also exit 4, with no report. |

Only PASS counts as an acceptance. A PASS has a completion label:

- `complete`: the run ended as the scenario expects.
- `reached <card>, stopped by design`: the scenario says `stop_at`, and the run reached that card.
  The steps after it belong to the captain (merge, pull requests, paid generation the captain must
  confirm), so the workflow was checked up to that card only. It is not a complete pass. A report marked **OFFLINE FIXTURE** comes from the offline test
(`--offline-fixture`, stub providers) and never counts.

## Scenario files

There is one reviewed file per bundled workflow on the Start form: `tests/acceptance/<id>.yaml`.
`scripts/acceptance/scenarios.ts` validates them and makes the card decisions.

```yaml
schema: 2
workflow: documents
pin: { version: 1, sha256: "<64 hex>" }  # bun scripts/acceptance/pin.ts documents
topic: "..."                       # the brief after "ACCEPT <date>"
start:
  provider: null                   # the board's provider select: null (Studio's default), claude, codex
  params: {}                       # only params the board's form for this workflow sends
  required_params: [folder]        # captain input; missing ones STOP before start (pass --params)
providers: [codex]                 # vendors that must report signed in
approvals: { staffing: false }      # the Start form's staffing table; nothing else
cards:                             # safe cards; anything else STOPs
  - { node: accept, kind: acceptance, answer: approve-draft, note: "..." }
  - { node: hold, action: wait }   # leave it for a person on the board; the run keeps following
  - { node: escalation, action: stop }
expect:
  status: succeeded                # or failed / cancelled; or instead: stop_at: <card node>
  result: done                     # optional; a run that ends on a plain hook reports done
  artifacts: [{ deliver: 1 }]      # {deliver: n} | {outputs: n} | {file: <path in the run folder>}
budget: { wall_minutes: 30, max_rounds: 14 }
```

A rule that answers a kind other than acceptance, question or plan is refused when the file loads.
Whether an answer is safe is decided against the run's definition: see the allowlist above.

### Shared with the stub-CLI harness

The stub-CLI acceptance harness (`bun run test:acceptance`, docs/acceptance.md) reads this same
list through `scenarioFiles`, `loadScenario` and `decideCard(scenario, card, def, { openAuthWindows })` in
`scripts/acceptance/scenarios.ts`:

- each file may carry a `stub:` list of offline runs (validated in `tests/acceptance/stub.ts`); a
  run's own card answers win, any other card goes through `decideCard`, and a run without its own
  `expect` checks this file's `expect`;
- internal and retired workflows have a file too, with `live: false`: `--all` skips them, and the
  harness fails when a bundled workflow has no file or no stub run.

## Offline test

`bun tests/live-acceptance.ts` runs the script against a throwaway Studio on a free port, with
throwaway data and stub CLI vendors. It covers a passing workflow, a failing one (exact error and
log link), a STOP on an unsafe card, a vendor that is not signed in (no sign-in started), both
budgets, and checks that no output or report holds the session.
